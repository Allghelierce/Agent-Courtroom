"""Start the existing court, durable engine, and dashboard. Mock mode is the default."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def node_binary() -> str:
    binary = shutil.which("node")
    if not binary and Path("/opt/homebrew/opt/node@24/bin/node").exists():
        binary = "/opt/homebrew/opt/node@24/bin/node"
    if not binary:
        raise RuntimeError("Install Node.js 24 or newer and put node on PATH")
    return binary


def request(url: str, body: dict | None = None):
    req = Request(url, data=json.dumps(body).encode() if body is not None else None,
                  headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def wait_for(url: str, process: subprocess.Popen, timeout: float = 60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited ({process.returncode}) while waiting for {url}; see logs")
        try:
            with urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError(f"Service did not become ready: {url}")


def stop(process: subprocess.Popen):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(0, 6), default=3)
    parser.add_argument("--no-ui", action="store_true")
    parser.add_argument("--live", action="store_true", help="Use real workers and court; requires credentials and incurs model cost")
    parser.add_argument("--duration", type=float, help="Stop after this many seconds; default waits for Ctrl-C")
    parser.add_argument("--step-delay", type=float, default=0.5)
    parser.add_argument("--db", type=Path, default=ROOT / "runs/demo/events.sqlite")
    args = parser.parse_args()
    if args.live and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("--live requires ANTHROPIC_API_KEY in the environment")
    if args.live:
        parser.error("Live execution is not enabled in this launcher yet: confirm benchmark rules and worker execution isolation first. Use the engine CLI for an explicitly configured run.")
    node = node_binary()
    logs = ROOT / "runs/demo" / time.strftime("%Y%m%d-%H%M%S")
    logs.mkdir(parents=True, exist_ok=True)
    processes = []
    handles = []
    env = {**os.environ, "COURT_MOCK": "1", "COURT_PORT": "4100", "COURT_HOST": "127.0.0.1",
           "NEXT_PUBLIC_ENGINE_URL": "http://127.0.0.1:8787", "COURT_CASES_DIR": str(ROOT / "runs/demo/cases")}

    def start(name, command, cwd):
        handle = (logs / f"{name}.log").open("w")
        handles.append(handle)
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(process)
        return process

    try:
        court = start("court", [node, "--import", "tsx", "src/server.ts"], ROOT / "court")
        wait_for("http://127.0.0.1:4100/health", court)
        engine = start("engine", [sys.executable, "-u", "-m", "courtroom_engine", "serve", "--workers", "0",
                                   "--court", "http://127.0.0.1:4100/verdict", "--db", str(args.db.resolve())], ROOT / "engine")
        wait_for("http://127.0.0.1:8787/health", engine)
        if not args.no_ui:
            mode = "start" if (ROOT / "ui/.next/BUILD_ID").exists() else "dev"
            ui = start("ui", [node, "node_modules/next/dist/bin/next", mode, "--hostname", "127.0.0.1", "--port", "3000"], ROOT / "ui")
            wait_for("http://127.0.0.1:3000", ui, timeout=120)
        for i in range(args.workers):
            request("http://127.0.0.1:8787/runs", {"task": "prices" if i % 2 else "coding", "brain": "scripted", "stepDelay": args.step_delay})
        print("Demo ready: http://localhost:3000" if not args.no_ui else "Engine ready: http://localhost:8787", flush=True)
        print(f"Scripted workers + mock court. Logs: {logs}\nCtrl-C stops only the processes this command started.", flush=True)
        started = time.monotonic()
        while args.duration is None or time.monotonic() - started < args.duration:
            if any(p.poll() is not None for p in processes):
                raise RuntimeError(f"A service exited unexpectedly; inspect {logs}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in reversed(processes):
            stop(process)
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    main()
