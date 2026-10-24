"""Starts workers, keeps track of them, and runs the with/without comparison."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import monitors
from .brains import DEFAULT_MODELS, ClaudeBrain, GroqBrain, ScriptedBrain
from .bus import Bus
from .court import HttpCourt, StubCourt
from .tasks import TASKS, Task
from .worker import Worker

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
        self._counter = 0

    def create_worker(self, cfg: RunConfig, court: Optional[str] = None, label: str = "worker") -> Worker:
        task = get_task(cfg.task)
        with self._lock:
            self._counter += 1
            worker_id = f"{label}-{self._counter}"
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
        return worker

    def start_worker(self, cfg: RunConfig, label: str = "worker") -> Worker:
        worker = self.create_worker(cfg, label=label)
        threading.Thread(target=worker.run, name=worker.id, daemon=True).start()
        return worker

    def compare(self, cfg: RunConfig) -> dict:
        """Runs the same task with and without the courtroom, side by side."""
        with_court = self.create_worker(cfg, label="with-court")
        without_court = self.create_worker(cfg, court="none", label="no-court")
        threads = [threading.Thread(target=w.run, name=w.id, daemon=True) for w in (with_court, without_court)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        result = {
            "withCourt": {**with_court.status.to_json(), "seconds": round(with_court.elapsed_seconds(), 2)},
            "withoutCourt": {**without_court.status.to_json(), "seconds": round(without_court.elapsed_seconds(), 2)},
        }
        self.bus.publish("comparison", result)
        return result
