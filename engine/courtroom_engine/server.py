"""HTTP + Server-Sent Events API for the dashboard.

GET  /stream                    SSE: every StreamMessage, history replayed first
GET  /history                   all StreamMessages so far, as a JSON array
GET  /workers                   current WorkerStatus for every worker
POST /runs                      start a worker; body is optional RunConfig overrides
POST /compare                   start a with/without-court comparison in the background
POST /workers/<id>/resolve      a human's Verdict for a worker awaiting escalation
"""

from __future__ import annotations

import json
import queue
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .engine import Engine, RunConfig
from .schema import Verdict

HEARTBEAT_SECONDS = 15


def _overrides(cfg: RunConfig, body: dict[str, Any]) -> RunConfig:
    fields = {
        "task": "task",
        "brain": "brain",
        "court": "court",
        "model": "model",
        "budgetUsd": "budget_usd",
        "maxSteps": "max_steps",
        "allMonitors": "all_monitors",
        "stepDelay": "step_delay",
    }
    return replace(cfg, **{attr: body[key] for key, attr in fields.items() if key in body})


def make_handler(engine: Engine, defaults: RunConfig):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format, *args):  # keep the console for the run log
            pass

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            return json.loads(self.rfile.read(length))

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if self.path == "/stream":
                return self._stream()
            if self.path == "/history":
                return self._json(200, engine.bus.history())
            if self.path == "/workers":
                return self._json(200, [w.status.to_json() for w in engine.workers.values()])
            self._json(404, {"error": "not found"})

        def do_POST(self):
            try:
                body = self._body()
            except json.JSONDecodeError:
                return self._json(400, {"error": "invalid JSON"})
            try:
                if self.path == "/runs":
                    worker = engine.start_worker(_overrides(defaults, body))
                    return self._json(201, worker.status.to_json())
                if self.path == "/compare":
                    cfg = _overrides(defaults, body)
                    threading.Thread(target=engine.compare, args=(cfg,), daemon=True).start()
                    return self._json(202, {"started": True})
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            parts = self.path.strip("/").split("/")
            if len(parts) == 3 and parts[0] == "workers" and parts[2] == "resolve":
                worker = engine.workers.get(parts[1])
                if worker is None:
                    return self._json(404, {"error": "no such worker"})
                try:
                    verdict = Verdict.from_json(body)
                except ValueError as e:
                    return self._json(400, {"error": str(e)})
                if verdict.ruling == "escalate":
                    return self._json(400, {"error": "a human has to pick continue, change_strategy, or halt"})
                if not worker.resolve(verdict):
                    return self._json(409, {"error": "worker is not awaiting a human"})
                return self._json(200, {"ok": True})
            self._json(404, {"error": "not found"})

        def _stream(self):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            history, q = engine.bus.subscribe()
            try:
                for message in history:
                    self._send_event(message)
                while True:
                    try:
                        self._send_event(q.get(timeout=HEARTBEAT_SECONDS))
                    except queue.Empty:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                engine.bus.unsubscribe(q)

        def _send_event(self, message: dict[str, Any]) -> None:
            self.wfile.write(f"data: {json.dumps(message)}\n\n".encode())
            self.wfile.flush()

    return Handler


def serve(engine: Engine, defaults: RunConfig, host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), make_handler(engine, defaults))
    server.daemon_threads = True
    print(f"Engine API on http://{host}:{port}  (SSE at /stream)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
