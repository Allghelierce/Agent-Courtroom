"""Persist before broadcasting. Subscription replay and live handoff share a lock."""

from __future__ import annotations

import json
import queue
import threading
from pathlib import Path
from typing import Any, Optional

from .store import Store


class Bus:
    def __init__(self, record_path: Optional[Path] = None, db_path: Optional[Path] = None):
        self._lock = threading.RLock()
        self._subscribers: list[queue.Queue] = []
        self.store = Store(db_path)
        self._record = None
        if record_path:
            record_path.parent.mkdir(parents=True, exist_ok=True)
            self._record = record_path.open("a", buffering=1)

    def next_event_id(self) -> int:
        return self.store.next_id("event")

    def next_charge_id(self) -> int:
        return self.store.next_id("charge")

    def next_worker_id(self) -> int:
        return self.store.next_id("worker")

    def publish(self, type_: str, data: dict[str, Any]) -> dict:
        with self._lock:
            message, created = self.store.append(type_, data)
            if not created:
                return message
            if self._record:
                try:
                    self._record.write(json.dumps(message) + "\n")
                except OSError:
                    self._record.close()
                    self._record = None
            for q in list(self._subscribers):
                try:
                    q.put_nowait(message)
                except queue.Full:
                    # Reconnect from the durable cursor instead of retaining unbounded memory.
                    self._subscribers.remove(q)
                    while not q.empty():
                        q.get_nowait()
                    q.put_nowait(None)
            return message

    def subscribe(self, after: int = 0) -> tuple[list[dict[str, Any]], queue.Queue]:
        """Returns the history so far plus a queue of everything after it."""
        q: queue.Queue = queue.Queue(maxsize=1000)
        with self._lock:
            history = self.store.history(after)
            self._subscribers.append(q)
            return history, q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def history(self, after: int = 0) -> list[dict[str, Any]]:
        return self.store.history(after)

    def snapshots(self) -> list[dict]:
        workers = {}
        for message in self.history():
            if message["type"] == "worker":
                workers[message["data"]["workerId"]] = message["data"]
        return list(workers.values())

    def trials(self) -> list[dict]:
        return [m["data"] for m in self.history() if m["type"] == "trial"]

    def close(self) -> None:
        with self._lock:
            if self._record:
                self._record.close()
                self._record = None
            self.store.close()
