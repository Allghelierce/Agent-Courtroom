"""Building the evidence packet and calling convene(packet) -> Verdict.

The real court belongs to Person B and sits behind an HTTP endpoint. StubCourt lets the
engine run end to end without it.
"""

from __future__ import annotations

import json
import math
import urllib.error
import urllib.request
import urllib.parse
from typing import Any, Protocol

from .schema import Charge, Event, Verdict

PACKET_EVENTS = 20


def build_packet(charge: Charge, events: list[Event], budget_usd: float, task: str, started_at: str | None = None) -> dict[str, Any]:
    mine = [e for e in events if e.workerId == charge.workerId]
    return {
        "charge": charge.to_json(),
        "events": [e.to_json() for e in mine[-PACKET_EVENTS:]],
        "testProgress": [
            {"step": e.step, "testsPassing": e.testsPassing, "testsTotal": e.testsTotal} for e in mine
        ],
        "spend": {"costUsd": round(sum(e.costUsd for e in mine), 6), "budgetUsd": budget_usd},
        "task": task,
        # Worker IDs restart with each engine run, so the court uses this to keep its
        # repeat-offender and budget history to the current run.
        **({"workerStartedAt": started_at} if started_at else {}),
    }


class Court(Protocol):
    def convene(self, packet: dict[str, Any]) -> Verdict: ...


class StubCourt:
    """Always rules change_strategy with the task's canned advice, citing the charged events."""

    def __init__(self, instruction: str):
        self.instruction = instruction

    def convene(self, packet: dict[str, Any]) -> Verdict:
        charge = packet["charge"]
        return Verdict(
            ruling="change_strategy",
            instruction=self.instruction,
            reasoning=f"[stub court] {charge['kind']}: {charge['summary']}",
            cited_events=charge["eventIds"],
        )


class HttpCourt:
    """POSTs the packet to Person B's court and parses the Verdict it returns."""

    def __init__(self, url: str, timeout: float = 60.0):
        self.url = url
        self.timeout = timeout
        self.last_trial = None
        self.last_case_id = None

    def convene(self, packet: dict[str, Any]) -> Verdict:
        self.last_trial = None
        self.last_case_id = None
        request = urllib.request.Request(
            self.url,
            data=json.dumps(packet).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                result = Verdict.from_json(json.load(response))
                self.last_case_id = response.headers.get("X-Case-Id")
            valid_ids = {event["id"] for event in packet["events"]}
            if not set(result.cited_events).issubset(valid_ids):
                raise ValueError("verdict cites events outside the packet")
            if self.last_case_id:
                try:
                    case_url = urllib.parse.urljoin(self.url, "/cases/" + urllib.parse.quote(self.last_case_id, safe=""))
                    with urllib.request.urlopen(case_url, timeout=min(self.timeout, 5)) as response:
                        trial = json.load(response)
                    cost = trial.get("costUsd")
                    if (trial.get("id") != self.last_case_id or trial.get("workerId") != packet["charge"]["workerId"]
                            or trial.get("charge", {}).get("id") != packet["charge"].get("id")
                            or isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0):
                        raise ValueError("invalid trial identity or cost")
                    self.last_trial = trial
                except (OSError, ValueError, TypeError, AttributeError):
                    # A valid verdict still applies; the missing accounting is explicitly incomplete.
                    pass
            return result
        except (OSError, ValueError, TypeError, AttributeError) as e:
            # No usable ruling: hand the case to a human instead of guessing.
            return Verdict(
                ruling="escalate",
                reasoning=f"Court at {self.url} gave no valid verdict ({type(e).__name__}: {e})",
                cited_events=packet["charge"]["eventIds"],
            )
