"""Starts workers, keeps track of them, and runs the with/without comparison."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import monitors
from .brains import ClaudeBrain, ScriptedBrain
from .bus import Bus
from .court import HttpCourt, StubCourt
from .worker import Worker

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEED = REPO_ROOT / "seed_repos" / "checkout"


@dataclass
class RunConfig:
    brain: str = "scripted"  # "scripted" or "claude"
    court: str = "stub"  # "stub", "none", or the URL of Person B's convene endpoint
    model: str = "claude-opus-5-5"
    budget_usd: float = 2.0
    max_steps: int = 60
    all_monitors: bool = False
    step_delay: float = 0.0  # scripted brain only
    seed_repo: Path = DEFAULT_SEED


def make_brain(cfg: RunConfig):
    if cfg.brain == "claude":
        return ClaudeBrain(model=cfg.model)
    if cfg.brain == "scripted":
        return ScriptedBrain(model=cfg.model, step_delay=cfg.step_delay)
    raise ValueError(f"unknown brain: {cfg.brain}")


def make_court(spec: str):
    if spec == "none":
        return None
    if spec == "stub":
        return StubCourt()
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
        with self._lock:
            self._counter += 1
            worker_id = f"{label}-{self._counter}"
        worker = Worker(
            worker_id,
            make_brain(cfg),
            cfg.seed_repo,
            self.bus,
            make_court(court if court is not None else cfg.court),
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
