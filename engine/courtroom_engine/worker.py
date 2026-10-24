"""The worker loop: one tool call per step, monitors after every step, court on a charge."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import monitors
from .bus import Bus
from .court import Court, build_packet
from .schema import Charge, Event, Verdict, WorkerStatus
from .tasks import Env, Task

HUMAN_WAIT_SECONDS = 600


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Worker:
    def __init__(
        self,
        worker_id: str,
        task: Task,
        brain,
        bus: Bus,
        court: Optional[Court],
        budget_usd: float = 2.0,
        max_steps: int = 60,
        enabled_monitors=monitors.MVP_MONITORS,
        seed: Optional[Path] = None,
        keep_env: bool = False,
    ):
        self.id = worker_id
        self.task = task
        self.brain = brain
        self.seed = seed or task.seed
        self.bus = bus
        self.court = court
        self.budget_usd = budget_usd
        self.max_steps = max_steps
        self.enabled_monitors = enabled_monitors
        self.keep_env = keep_env
        self.events: list[Event] = []
        self.window_start = 0  # monitors only see events after the last ruling
        self.started = 0.0
        self.stopped = 0.0
        self.brain_mode = "scripted"
        self.case_ids: set[str] = set()
        self.court_modes: set[str] = set()
        self._cancelled = threading.Event()
        self.status = WorkerStatus(
            workerId=worker_id,
            state="running",
            task=task.prompt,
            courtEnabled=court is not None,
            step=0,
            testsPassing=0,
            testsTotal=0,
            costUsd=0.0,
            budgetUsd=budget_usd,
            startedAt=now(),
        )
        self._human_verdict: Optional[Verdict] = None
        self._human_ready = threading.Event()

    # --- status helpers ---

    def _publish_status(self) -> None:
        self.bus.publish("worker", self.status.to_json())

    def _set_state(self, state: str) -> None:
        self.status.state = state
        self._publish_status()

    def _finish(self, state: str, summary: str) -> None:
        self.status.state = state
        self.status.summary = summary
        self.status.endedAt = now()
        self._publish_status()

    def elapsed_seconds(self) -> float:
        return (self.stopped or time.monotonic()) - self.started if self.started else 0.0

    def result(self) -> dict:
        status = self.status.to_json()
        return {**status, "seconds": round(self.elapsed_seconds(), 3),
                "workerCostUsd": round(self.status.costUsd, 6),
                "totalCostUsd": round(self.status.costUsd + self.status.courtCostUsd, 6) if self.status.courtCostComplete else None,
                "caseIds": sorted(self.case_ids), "courtModes": sorted(self.court_modes),
                "outcomeVerified": False}

    def cancel(self) -> None:
        self._cancelled.set()
        self._human_ready.set()

    # --- human escalation ---

    def resolve(self, verdict: Verdict) -> bool:
        if self.status.state != "awaiting_human":
            return False
        self._human_verdict = verdict
        self._human_ready.set()
        return True

    # --- main loop ---

    def run(self) -> WorkerStatus:
        self.started = time.monotonic()
        self.status.costMode = "simulated" if self.brain_mode == "scripted" else "estimated_from_usage"
        env = None
        try:
            env = self.task.make_env(self.seed)
            self.status.testsPassing, self.status.testsTotal = env.baseline()
            self._publish_status()
            self._loop(env)
        except Exception as e:  # a crashed worker should still end its run cleanly
            self._finish("failed", f"Worker crashed: {type(e).__name__}: {e}")
        finally:
            self.stopped = time.monotonic()
            if env is not None and not self.keep_env:
                env.cleanup()
        return self.status

    def _loop(self, env: Env) -> None:
        while True:
            if self._cancelled.is_set():
                return self._finish("halted", "Cancelled by operator")
            if self.status.step >= self.max_steps:
                return self._finish("failed", f"Hit the {self.max_steps}-step limit at {self._score()}")
            if self.status.costUsd >= self.budget_usd:
                return self._finish("failed", f"Ran out of budget (${self.budget_usd:.2f}) at {self._score()}")

            action = self.brain.next_action()
            self.status.costUsd += action.cost_usd

            if action.tool is None:
                self.status.testsPassing, self.status.testsTotal = env.baseline()
                if self._all_passing():
                    return self._finish("succeeded", f"Finished at {self._score()}. {action.text}".strip())
                return self._finish("failed", f"Worker stopped at {self._score()}: {action.text}".strip())

            outcome = env.execute(action.tool, action.args)
            if outcome.progress:
                self.status.testsPassing, self.status.testsTotal = outcome.progress
            self.status.step += 1
            event = Event(
                id=self.bus.next_event_id(),
                workerId=self.id,
                step=self.status.step,
                tool=action.tool,
                args=action.args,
                tokens=action.tokens,
                costUsd=round(action.cost_usd, 6),
                testsPassing=self.status.testsPassing,
                testsTotal=self.status.testsTotal,
                timestamp=now(),
                error=outcome.error,
                result=outcome.summary,
            )
            self.events.append(event)
            self.bus.publish("event", event.to_json())
            self._publish_status()

            if outcome.progress and self._all_passing():
                return self._finish("succeeded", f"Finished at {self._score()} after {self.status.step} steps")

            instruction = None
            verdict = self._check_monitors()
            if verdict is not None:
                if verdict.ruling == "halt":
                    return self._finish("halted", f"Court halted the run at {self._score()}: {verdict.reasoning}")
                if verdict.ruling == "change_strategy":
                    instruction = verdict.instruction
            self.brain.observe(outcome.output, outcome.error is not None, instruction)

    def _check_monitors(self) -> Optional[Verdict]:
        finding = monitors.check(self.events[self.window_start :], self.budget_usd, self.enabled_monitors)
        if finding is None:
            return None
        charge = Charge(
            id=self.bus.next_charge_id(),
            workerId=self.id,
            kind=finding.kind,
            summary=finding.summary,
            eventIds=finding.eventIds,
        )
        self.bus.publish("charge", charge.to_json())
        self.window_start = len(self.events)
        if self.court is None:
            return None  # without a court the warning light flashes and nobody acts

        self._set_state("on_trial")
        verdict = self.court.convene(build_packet(charge, self.events, self.budget_usd, self.task.prompt))
        trial = getattr(self.court, "last_trial", None)
        case_id = getattr(self.court, "last_case_id", None)
        if trial:
            self.bus.publish("trial", trial)
            if trial["id"] not in self.case_ids:
                self.case_ids.add(trial["id"])
                self.status.courtCostUsd += trial["costUsd"]
            self.status.courtCostComplete &= trial.get("costComplete", True)
            self.court_modes.add("mock" if trial.get("mock") else "live")
        elif hasattr(self.court, "last_trial"):
            self.status.courtCostComplete = False
            self.court_modes.add("unknown")
        else:
            self.court_modes.add("stub")
        self._publish_verdict(charge, verdict, case_id)
        if verdict.ruling == "escalate":
            verdict = self._wait_for_human(charge)
        if verdict.ruling != "halt":
            self._set_state("running")
        return verdict

    def _wait_for_human(self, charge: Charge) -> Verdict:
        self._human_ready.clear()
        self._set_state("awaiting_human")
        if self._cancelled.is_set():
            self._human_ready.set()
        if self._human_ready.wait(HUMAN_WAIT_SECONDS) and self._human_verdict:
            verdict = self._human_verdict
        else:
            verdict = Verdict(ruling="halt", reasoning="No human responded to the escalation in time")
        self._publish_verdict(charge, verdict)
        return verdict

    def _publish_verdict(self, charge: Charge, verdict: Verdict, case_id: Optional[str] = None) -> None:
        data = {"workerId": self.id, "chargeId": charge.id, "verdict": verdict.to_json()}
        if case_id:
            data["caseId"] = case_id
        self.bus.publish("verdict", data)

    def _all_passing(self) -> bool:
        return self.status.testsTotal > 0 and self.status.testsPassing == self.status.testsTotal

    def _score(self) -> str:
        unit = "tests passing" if self.task.name == "coding" else "done"
        return f"{self.status.testsPassing}/{self.status.testsTotal} {unit}"
