"""Starts workers, keeps track of them, and runs the with/without comparison."""

from __future__ import annotations

import threading
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import monitors
from .brains import DEFAULT_MODELS, ClaudeBrain, GroqBrain, ScriptedBrain
from .bus import Bus
from .court import HttpCourt, StubCourt
from .tasks import TASKS, Task
from .worker import Worker
from .costs import PRICES, model_provider, pricing_info

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class RunConfig:
    task: str = "coding"  # a key of tasks.TASKS
    brain: str = "scripted"  # "scripted", "claude", or "groq"
    court: str = "stub"  # "stub", "none", or the URL of Person B's convene endpoint
    model: Optional[str] = None  # defaults per brain, see brains.DEFAULT_MODELS
    budget_usd: float = 2.0
    max_steps: int = 60
    all_monitors: bool = False
    step_delay: float = 0.0  # scripted brain only
    seed: Optional[Path] = None  # defaults to the task's own seed

    def validate(self) -> None:
        if not isinstance(self.task, str) or (self.model is not None and (not isinstance(self.model, str) or not self.model)):
            raise ValueError("task must be a string and model must be a nonempty string or omitted")
        get_task(self.task)
        if not isinstance(self.brain, str) or self.brain not in DEFAULT_MODELS:
            raise ValueError("brain must be scripted, claude, or groq")
        if self.model is not None and self.brain != "scripted" and model_provider(self.model) != self.brain:
            raise ValueError(f"model {self.model} is not a priced {self.brain} model; see shared/model-prices.json")
        if isinstance(self.budget_usd, bool) or not isinstance(self.budget_usd, (int, float)) or not math.isfinite(self.budget_usd) or self.budget_usd <= 0:
            raise ValueError("budgetUsd must be a positive finite number")
        if type(self.max_steps) is not int or not 1 <= self.max_steps <= 10000:
            raise ValueError("maxSteps must be an integer between 1 and 10000")
        if isinstance(self.step_delay, bool) or not isinstance(self.step_delay, (int, float)) or not math.isfinite(self.step_delay) or not 0 <= self.step_delay <= 60:
            raise ValueError("stepDelay must be between 0 and 60 seconds")
        if type(self.all_monitors) is not bool:
            raise ValueError("allMonitors must be boolean")
        if not isinstance(self.court, str) or not (self.court in ("stub", "none") or self.court.startswith(("http://", "https://"))):
            raise ValueError("court must be stub, none, or an HTTP URL")


def get_task(name: str) -> Task:
    if name not in TASKS:
        raise ValueError(f"unknown task: {name} (choose from {', '.join(TASKS)})")
    return TASKS[name]


def make_brain(cfg: RunConfig, task: Task):
    if cfg.brain not in DEFAULT_MODELS:
        raise ValueError(f"unknown brain: {cfg.brain}")
    model = cfg.model or DEFAULT_MODELS[cfg.brain]
    if cfg.brain == "claude":
        return ClaudeBrain(task, model=model)
    if cfg.brain == "groq":
        return GroqBrain(task, model=model)
    if cfg.brain == "scripted":
        return ScriptedBrain(task, model=model, step_delay=cfg.step_delay)
    raise ValueError(f"unknown brain: {cfg.brain}")


def make_court(spec: str, task: Task):
    if spec == "none":
        return None
    if spec == "stub":
        return StubCourt(task.stub_instruction)
    if spec.startswith(("http://", "https://")):
        return HttpCourt(spec)
    raise ValueError(f"unknown court: {spec}")


class Engine:
    def __init__(self, bus: Bus):
        self.bus = bus
        self.workers: dict[str, Worker] = {}
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(5)
        self._comparison_lock = threading.Lock()
        # Restoring history cannot resume a Python thread that died with the process.
        for status in bus.snapshots():
            if status["state"] in ("running", "on_trial", "awaiting_human"):
                bus.publish("worker", {**status, "state": "failed", "endedAt": datetime.now(timezone.utc).isoformat(),
                                       "summary": "Interrupted by engine restart; history preserved."})

    def create_worker(self, cfg: RunConfig, court: Optional[str] = None, label: str = "worker") -> Worker:
        cfg.validate()
        task = get_task(cfg.task)
        worker_id = f"{label}-{self.bus.next_worker_id()}"
        worker = Worker(
            worker_id,
            task,
            make_brain(cfg, task),
            self.bus,
            make_court(court if court is not None else cfg.court, task),
            seed=cfg.seed,
            budget_usd=cfg.budget_usd,
            max_steps=cfg.max_steps,
            enabled_monitors=tuple(monitors.ALL_MONITORS) if cfg.all_monitors else monitors.MVP_MONITORS,
        )
        with self._lock:
            self.workers[worker_id] = worker
        worker.brain_mode = cfg.brain
        return worker

    def start_worker(self, cfg: RunConfig, label: str = "worker") -> Worker:
        if not self._slots.acquire(blocking=False):
            raise ValueError("At most five workers may run at once")
        try:
            worker = self.create_worker(cfg, label=label)
        except Exception:
            self._slots.release()
            raise

        def run():
            try:
                worker.run()
            finally:
                self._slots.release()

        threading.Thread(target=run, name=worker.id, daemon=True).start()
        return worker

    def start_comparison(self, cfg: RunConfig) -> None:
        cfg.validate()
        if not self._comparison_lock.acquire(blocking=False):
            raise ValueError("A comparison is already running")
        if not self._slots.acquire(blocking=False):
            self._comparison_lock.release()
            raise ValueError("All worker slots are busy")

        def run():
            try:
                self.compare(cfg)
            except Exception as exc:
                self.bus.publish("comparison_error", {"error": str(exc)})
            finally:
                self._slots.release()
                self._comparison_lock.release()

        threading.Thread(target=run, name="comparison", daemon=True).start()

    def compare(self, cfg: RunConfig) -> dict:
        """Sequential paired run: include court overhead without resource contention."""
        cfg.validate()
        if cfg.court == "none":
            raise ValueError("Comparison needs a court-enabled arm")
        with_court = self.create_worker(cfg, label="with-court")
        without_court = self.create_worker(cfg, court="none", label="no-court")
        for worker in (with_court, without_court):
            worker.run()
        model = cfg.model or DEFAULT_MODELS[cfg.brain]
        result = {
            "id": f"comparison-{uuid.uuid4().hex}",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "task": cfg.task,
            "brain": cfg.brain,
            "model": model,
            "court": cfg.court,
            "budgetUsd": cfg.budget_usd,
            "maxSteps": cfg.max_steps,
            "costMode": "simulated" if cfg.brain == "scripted" else "estimated_from_usage",
            # The court always prices with Claude rates; the worker's come from its own model's provider.
            "pricingDate": PRICES["providers"]["claude"]["verifiedAt"],
            "pricingSource": PRICES["providers"]["claude"]["source"],
            "workerPricingDate": pricing_info(model)["verifiedAt"],
            "workerPricingSource": pricing_info(model)["source"],
            "successCriteria": "pending human definition; state is engine-reported test completion only",
            "withCourt": with_court.result(),
            "withoutCourt": without_court.result(),
        }
        a, b = result["withCourt"]["totalCostUsd"], result["withoutCourt"]["totalCostUsd"]
        result["savingsUsd"] = round(b - a, 6) if a is not None and b is not None else None
        result["savingsPercent"] = round(100 * (b - a) / b, 2) if a is not None and b else None
        self.bus.publish("comparison", result)
        return result
