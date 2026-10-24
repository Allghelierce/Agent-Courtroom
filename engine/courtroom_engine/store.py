"""Durable ordered messages and ID allocation for the single-host demo."""

from __future__ import annotations

import fcntl
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class Store:
    def __init__(self, path: Path | None = None):
        self.lock = threading.RLock()
        self._file_lock = None
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._file_lock = Path(str(path) + ".lock").open("a")
            try:
                fcntl.flock(self._file_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                self._file_lock.close()
                raise ValueError(f"Database already in use: {path}. Use the running API or a different --db.") from None
        self.db = sqlite3.connect(str(path) if path else ":memory:", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                data TEXT NOT NULL,
                message_key TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
            PRAGMA user_version=1;
        """)

    def next_id(self, name: str) -> int:
        with self.lock, self.db:
            self.db.execute("INSERT INTO counters VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value=value+1", (name,))
            return self.db.execute("SELECT value FROM counters WHERE name=?", (name,)).fetchone()[0]

    def append(self, kind: str, data: dict[str, Any]) -> tuple[dict, bool]:
        payload = json.dumps(data, sort_keys=True, allow_nan=False)
        key = f"{kind}:{data['id']}" if kind in ("event", "charge", "trial") else None
        with self.lock, self.db:
            if key:
                existing = self.db.execute("SELECT sequence, data FROM messages WHERE message_key=?", (key,)).fetchone()
                if existing:
                    if existing[1] != payload:
                        raise ValueError(f"Conflicting content for {key}")
                    return {"sequence": existing[0], "type": kind, "data": json.loads(payload)}, False
            cursor = self.db.execute("INSERT INTO messages(kind,data,message_key) VALUES (?,?,?)", (kind, payload, key))
            if kind in ("event", "charge"):
                self.db.execute("INSERT INTO counters VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)", (kind, data["id"]))
            message = {"sequence": cursor.lastrowid, "type": kind, "data": json.loads(payload)}
        return message, True

    def history(self, after: int = 0) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT sequence,kind,data FROM messages WHERE sequence>? ORDER BY sequence", (after,)).fetchall()
        return [{"sequence": seq, "type": kind, "data": json.loads(data)} for seq, kind, data in rows]

    def close(self) -> None:
        with self.lock:
            self.db.close()
            if self._file_lock:
                self._file_lock.close()
                self._file_lock = None
