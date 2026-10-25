"""One harder checkout worker; an operator supplies assistant advice at monitor triggers.

This is an interactive assisted experiment, not the multi-model court benchmark.
Enter one JSON Verdict on stdin at each ADVICE_REQUIRED prompt.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values

from benchmark import ROOT, seed_digest
from courtroom_engine.bus import Bus
from courtroom_engine.engine import get_task
from courtroom_engine.brains import GroqBrain
from courtroom_engine.schema import Verdict
from courtroom_engine.worker import Worker
from courtroom_engine.verification.stripe import evaluate_stripe


class ProgressBus(Bus):
    def publish(self, type_, data):
        result = super().publish(type_, data)
        if type_ == "event" and data["step"] % 10 == 0:
            print("MILESTONE " + json.dumps({k: data.get(k) for k in
                  ("step", "testsPassing", "testsTotal", "tool", "result")}), flush=True)
        return result


class AssistantAdvice:
    # No automatic model court or free-cost accounting claim.
    last_trial = None
    last_case_id = None

    def __init__(self, out, current_env, brain):
        self.out, self.current_env, self.brain = out, current_env, brain
        self.wait_seconds = 0.0
        self.count = 0

    def convene(self, packet):
        self.count += 1
        directory = self.out / "advice" / str(self.count)
        directory.mkdir(parents=True)
        (directory / "packet.json").write_text(json.dumps(packet, indent=2) + "\n")
        (directory / "messages.json").write_text(json.dumps(self.brain.messages, indent=2) + "\n")
        shutil.copytree(self.current_env[0].root, directory / "source",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        print("ADVICE_REQUIRED " + str(directory), flush=True)
        started = time.monotonic()
        while True:
            line = sys.stdin.readline()
            if not line:
                verdict = Verdict(ruling="halt", reasoning="Advice input closed; no automatic advice substituted.")
                break
            try:
                verdict = Verdict.from_json(json.loads(line))
                if verdict.ruling == "escalate":
                    raise ValueError("Supply advice, continue, or halt; this is already the advice channel")
                ids = {e["id"] for e in packet["events"]}
                if not set(verdict.cited_events).issubset(ids):
                    raise ValueError("Cite only events from this packet")
                break
            except (ValueError, TypeError) as exc:
                print("INVALID_ADVICE " + str(exc), flush=True)
        waited = time.monotonic() - started
        self.wait_seconds += waited
        (directory / "response.json").write_text(json.dumps({
            "source": "Codex assistant via operator input; not a human or model court",
            "waitSeconds": waited, "verdict": verdict.to_json(),
        }, indent=2) + "\n")
        return verdict


def main():
    values = dotenv_values(ROOT / ".env.local")
    key = (values.get("GROQ_API_KEY") or "").strip()
    if not key:
        raise SystemExit("GROQ_API_KEY missing")
    for name, value in values.items():
        if value is not None:
            os.environ.setdefault(name, value)
    os.environ["GROQ_API_KEY"] = key
    out = ROOT / "runs/benchmarks" / (datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + "-assistant-advice")
    out.mkdir(parents=True)
    seed = out / "seed"
    shutil.copytree(ROOT / "seed_repos/checkout_hard", seed,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    task = get_task("checkout-v2")
    (out / "prompt.json").write_text(json.dumps({"prompt": task.prompt,
        "systemPrompt": task.system_prompt, "tools": task.tools}, indent=2) + "\n")
    (out / "manifest.json").write_text(json.dumps({
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "supervisionMode": "assistant_advice", "modelCourtUsed": False,
        "model": "openai/gpt-oss-20b", "maxSteps": 100, "workerBudgetUsd": 0.5,
        "seedDigest": seed_digest(seed), "freshStart": True,
        "monitors": ["looping", "stalling"], "adviceCost": "unknown; external assistant usage",
        "limitation": "Advisor can inspect source and knows prior attempts; not an equal-information courtroom comparison.",
    }, indent=2) + "\n")
    current_env = []
    make_env = task.make_env

    def capture_env(path):
        env = make_env(path)
        current_env[:] = [env]
        return env

    task = replace(task, make_env=capture_env)
    brain = GroqBrain(task, model="openai/gpt-oss-20b")
    # Keep the existing worker injection hook but identify its author accurately.
    original_observe = brain.observe

    def observe(output, is_error, instruction=None, summary=""):
        original_observe(output, is_error, None, summary)
        if instruction:
            brain.messages.append({"role": "user", "content": "ASSISTANT ADVISOR: " + instruction})

    brain.observe = observe
    bus = ProgressBus(record_path=out / "events.jsonl", db_path=out / "events.sqlite")
    advisor = AssistantAdvice(out, current_env, brain)
    print("RUN " + str(out), flush=True)
    try:
        worker = Worker("advised-1", task, brain, bus, advisor, seed=seed,
                        max_steps=100, budget_usd=0.5, evidence_dir=out / "evidence", human_wait_seconds=0)
        worker.brain_mode = "groq"
        worker.run()
        result = worker.result()
        result.update(supervisionMode="assistant_advice", modelCourtUsed=False,
                      courtModes=["assistant_advice"] if advisor.count else [],
                      courtCostUsd=None, courtCostComplete=False, totalCostUsd=None,
                      adviceCount=advisor.count, adviceWaitSeconds=round(advisor.wait_seconds, 3),
                      secondsExcludingAdviceWait=round(worker.elapsed_seconds() - advisor.wait_seconds, 3))
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        if result.get("recoveryChecks", {}).get("status") == "passed":
            stripe = evaluate_stripe(out / "evidence/source", run_id=out.name,
                                     secret_key=os.environ.get("STRIPE_TEST_SECRET_KEY", ""))
        else:
            stripe = {"status": "not_run", "reason": "Recovery checks did not pass"}
        result["stripeChecks"] = stripe
        report_path = out / "evidence/verification.json"
        if report_path.exists():
            report = json.loads(report_path.read_text())
            report["stripeChecks"] = stripe
            report_path.write_text(json.dumps(report, indent=2) + "\n")
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        summary = {k: result.get(k) for k in ("state", "modelTurns", "summary", "adviceCount",
                   "seconds", "adviceWaitSeconds", "secondsExcludingAdviceWait")}
        summary.update(recoveryChecks={k: result.get("recoveryChecks", {}).get(k)
                       for k in ("status", "passing", "total")}, stripeStatus=stripe["status"])
        (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print("FINAL " + json.dumps(summary), flush=True)
    finally:
        bus.close()


if __name__ == "__main__":
    main()
