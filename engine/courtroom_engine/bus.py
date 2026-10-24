"""The shared log. Everything the UI sees goes through here as a StreamMessage."""

from __future__ import annotations

import json
import queue
import threading
from pathlib import Path
from typing import Any, Optional


class Bus:
    def __init__(self, record_path: Optional[Path] = None):
        self._lock = threading.Lock()
        self._history: list[dict[str, Any]] = []
        self._subscribers: list[queue.Queue] = []
        self._next_event_id = 1
        self._next_charge_id = 1
        self._record = None
        if record_path:
            record_path.parent.mkdir(parents=True, exist_ok=True)
            self._record = record_path.open("a", buffering=1)

    def next_event_id(self) -> int:
        with self._lock:
            n = self._next_event_id
            self._next_event_id += 1
            return n

    def next_charge_id(self) -> int:
        with self._lock:
            n = self._next_charge_id
            self._next_charge_id += 1
            return n

    def publish(self, type_: str, data: dict[str, Any]) -> None:
        message = {"type": type_, "data": data}
        with self._lock:
            self._history.append(message)
            if self._record:
                self._record.write(json.dumps(message) + "\n")
            for q in self._subscribers:
                q.put(message)

    def subscribe(self) -> tuple[list[dict[str, Any]], queue.Queue]:
        """Returns the history so far plus a queue of everything after it."""
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._subscribers.append(q)
            return list(self._history), q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._history)
