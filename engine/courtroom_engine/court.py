"""Building the evidence packet and calling convene(packet) -> Verdict.

The real court belongs to Person B and sits behind an HTTP endpoint. StubCourt lets the
engine run end to end without it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Protocol

from .schema import Charge, Event, Verdict

PACKET_EVENTS = 20


def build_packet(charge: Charge, events: list[Event], budget_usd: float, task: str) -> dict[str, Any]:
    mine = [e for e in events if e.workerId == charge.workerId]
    return {
        "charge": charge.to_json(),
        "events": [e.to_json() for e in mine[-PACKET_EVENTS:]],
        "testProgress": [
            {"step": e.step, "testsPassing": e.testsPassing, "testsTotal": e.testsTotal} for e in mine
        ],
        "spend": {"costUsd": round(sum(e.costUsd for e in mine), 6), "budgetUsd": budget_usd},
        "task": task,
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

    def __init__(self, url: str, timeout: float = 180.0):
        self.url = url
        self.timeout = timeout

    def convene(self, packet: dict[str, Any]) -> Verdict:
        request = urllib.request.Request(
            self.url,
            data=json.dumps(packet).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return Verdict.from_json(json.load(response))
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as e:
            # No usable ruling: hand the case to a human instead of guessing.
            return Verdict(
                ruling="escalate",
                reasoning=f"Court at {self.url} gave no valid verdict ({type(e).__name__}: {e})",
                cited_events=packet["charge"]["eventIds"],
            )
