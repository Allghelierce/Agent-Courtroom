"""Exercise the real Python/TypeScript HTTP boundary without model API calls."""

import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from demo import ROOT, node_binary, request, stop, wait_for


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def eventually(check, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for integration result")


def main():
    out = ROOT / "runs/smoke" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    out.mkdir(parents=True)
    court_port, engine_port = free_port(), free_port()
    while engine_port == court_port:
        engine_port = free_port()
    court_url = f"http://127.0.0.1:{court_port}"
    engine_url = f"http://127.0.0.1:{engine_port}"
    env = {**os.environ, "COURT_MOCK": "1", "COURT_PORT": str(court_port),
           "COURT_HOST": "127.0.0.1", "COURT_CASES_DIR": str(out / "cases")}
    processes, handles = [], []
    checks = []

    def start(name, command, cwd):
        handle = (out / f"{name}.log").open("w")
        handles.append(handle)
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=handle,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(process)
        return process

    engine_command = [sys.executable, "-u", "-m", "courtroom_engine", "serve", "--workers", "0",
                      "--port", str(engine_port), "--court", court_url + "/verdict",
                      "--step-delay", "0", "--db", str(out / "events.sqlite"),
                      "--record", str(out / "events.jsonl")]
    try:
        court = start("court", [node_binary(), "--import", "tsx", "src/server.ts"], ROOT / "court")
        wait_for(court_url + "/health", court)
        engine = start("engine", engine_command, ROOT / "engine")
        wait_for(engine_url + "/health", engine)
        ids = {request(engine_url + "/runs", {"task": task, "maxSteps": 30})["workerId"]
               for task in ("coding", "prices", "prices")}
        assert len(ids) == 3

        def completed():
            workers = request(engine_url + "/workers")
            return workers if len(workers) == 3 and all(w["state"] in ("succeeded", "failed", "halted") for w in workers) else None

        workers = eventually(completed)
        assert all(w["state"] == "succeeded" for w in workers), workers
        history = request(engine_url + "/history")
        events = [m["data"] for m in history if m["type"] == "event"]
        assert len({e["id"] for e in events}) == len(events)
        checks.append("three concurrent workers complete with unique event IDs")
        cases = request(engine_url + "/cases")
        assert {case["workerId"] for case in cases} == ids
        case_ids = {case["id"] for case in cases}
        for message in history:
            if message["type"] == "verdict":
                assert message["data"]["caseId"] in case_ids
        assert request(engine_url + "/cases/" + cases[0]["id"]) == cases[0]
        checks.append("HTTP court verdicts link to durable trial transcripts")
        last = history[-1]["sequence"]
        req = Request(engine_url + "/stream", headers={"Last-Event-ID": str(last - 1)})
        with urlopen(req, timeout=5) as response:
            assert response.readline().decode().strip() == f"id: {last}"
            assert json.loads(response.readline().decode().removeprefix("data: ")) == history[-1]
        checks.append("SSE reconnect resumes immediately after the saved cursor")
        stop(engine)
        engine = start("engine-restarted", engine_command, ROOT / "engine")
        wait_for(engine_url + "/health", engine)
        assert request(engine_url + "/history") == history
        assert request(engine_url + "/workers") == workers
        assert request(engine_url + "/cases") == cases
        new_worker = request(engine_url + "/runs", {"task": "prices", "maxSteps": 1})
        assert new_worker["workerId"] not in ids
        checks.append("restart preserves history, workers, cases, and worker ID allocation")
        benchmark = subprocess.run([sys.executable, "scripts/benchmark.py", "--repetitions", "1",
                                    "--court", court_url + "/verdict", "--output", str(out / "benchmark")],
                                   cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
        (out / "benchmark.log").write_text(benchmark.stdout + benchmark.stderr)
        assert benchmark.returncode == 0, benchmark.stdout + benchmark.stderr
        results = json.loads((out / "benchmark/runs.json").read_text())
        assert len(results) == 2
        for result in results:
            assert result["costMode"] == "simulated"
            assert result["withCourt"]["state"] == "succeeded", result
            assert result["withoutCourt"]["state"] != "succeeded", result
            for arm in ("withCourt", "withoutCourt"):
                r = result[arm]
                assert r["totalCostUsd"] is not None
                assert abs(r["totalCostUsd"] - r["workerCostUsd"] - r["courtCostUsd"]) < 1e-6
                assert r["outcomeVerified"] is False
        assert (out / "benchmark/summary.csv").exists()
        checks.append("paired coding and price runs export raw data and honest cost totals")
        (out / "report.json").write_text(json.dumps({"passed": True, "checks": checks}, indent=2) + "\n")
        print("PASS: " + "\nPASS: ".join(checks))
        print(f"Evidence: {out}")
    finally:
        for process in reversed(processes):
            stop(process)
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    main()
