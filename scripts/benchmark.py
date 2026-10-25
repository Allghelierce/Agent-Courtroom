"""Run paired tasks through the existing engine; keep raw results and export a summary."""

import argparse
import csv
import hashlib
import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from courtroom_engine.bus import Bus
from courtroom_engine.engine import Engine, RunConfig, get_task
from demo import Services, node_binary, wait_for


def seed_digest(path: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(path.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts:
            digest.update(str(file.relative_to(path)).encode())
            digest.update(file.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", nargs="+", choices=("coding", "prices", "checkout-v2"), default=["coding", "prices"])
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--court", default="http://127.0.0.1:4100/verdict")
    parser.add_argument("--brain", choices=("scripted", "claude", "groq"), default="scripted")
    parser.add_argument("--model", help="Defaults to the selected provider's worker model")
    parser.add_argument("--budget", type=float, default=2.0)
    parser.add_argument("--max-steps", type=int, default=30)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--success-criteria", help="Human-approved evaluation definition, recorded verbatim")
    parser.add_argument("--decisions", type=Path, help="Decision record to freeze with the benchmark; provides success criteria")
    parser.add_argument("--env-file", type=Path, help="Load API keys from a local ignored dotenv file")
    parser.add_argument("--start-court", action="store_true", help="Start a separate court on a temporary port; same provider as the worker")
    parser.add_argument("--stripe-sandbox", action="store_true", help="Verify recovered checkout-v2 snapshots through the Stripe sandbox adapter")
    args = parser.parse_args()
    if args.stripe_sandbox and args.tasks != ["checkout-v2"]:
        parser.error("--stripe-sandbox requires --tasks checkout-v2")
    if args.env_file:
        if not args.env_file.is_file():
            parser.error("--env-file does not exist")
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    decisions = args.decisions.read_text() if args.decisions else None
    if decisions and not args.success_criteria:
        args.success_criteria = "\n".join(line for line in decisions.splitlines()
                                        if line.startswith(("- Success rule:", "- Allowed changes:", "- Verification method:")))
        if len(args.success_criteria.splitlines()) != 3 or "not decided yet" in args.success_criteria:
            parser.error("The decision record needs all three benchmark answers")
    if not 1 <= args.repetitions <= 20:
        parser.error("--repetitions must be between 1 and 20")
    if args.brain != "scripted":
        key = "GROQ_API_KEY" if args.brain == "groq" else "ANTHROPIC_API_KEY"
        if not args.success_criteria or not os.environ.get(key):
            parser.error(f"Real comparisons require --success-criteria and {key}")
        if not args.court.startswith(("http://", "https://")):
            parser.error("Real comparisons need the HTTP court; the stub court's $0 cost isn't a real overhead")
    configs = {task: RunConfig(task=task, brain=args.brain, model=args.model, court=args.court,
                               budget_usd=args.budget, max_steps=args.max_steps, human_wait_seconds=0,
                               success_criteria=args.success_criteria or "Scripted integration check; human outcome review pending") for task in args.tasks}
    try:
        for cfg in configs.values():
            cfg.validate()
    except ValueError as e:
        parser.error(str(e))
    out = args.output or ROOT / "runs/benchmarks" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    out.mkdir(parents=True, exist_ok=False)
    if decisions:
        (out / "decisions.md").write_text(decisions)
    for task, cfg in configs.items():
        definition = get_task(task)
        seed = out / "seeds" / task
        shutil.copytree(definition.seed, seed, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        cfg.seed, cfg.evidence_dir = seed, out / "evidence"
        (seed.parent / f"{task}-prompt.json").write_text(json.dumps({
            "prompt": definition.prompt, "systemPrompt": definition.system_prompt, "tools": definition.tools,
        }, indent=2) + "\n")
    bus = Bus(record_path=out / "events.jsonl", db_path=out / "events.sqlite")
    services = Services(out, dict(os.environ))
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True).strip())
    except (OSError, subprocess.SubprocessError):
        revision, dirty = "unavailable", True
    results = []
    try:
        if args.start_court:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            env = {**os.environ, "COURT_PORT": str(port), "COURT_HOST": "127.0.0.1",
                   "COURT_CASES_DIR": str((out / "cases").resolve()),
                   "COURT_MOCK": "1" if args.brain == "scripted" else "0",
                   "COURT_PROVIDER": "groq" if args.brain == "groq" else "anthropic"}
            court = services.start("court", [node_binary(), "--import", "tsx", "src/server.ts"], ROOT / "court", env)
            wait_for(f"http://127.0.0.1:{port}/health", court)
            for cfg in configs.values():
                cfg.court = f"http://127.0.0.1:{port}/verdict"
        (out / "manifest.json").write_text(json.dumps({
            "revision": revision, "dirtyWorkingTree": dirty, "brain": args.brain,
            "repetitions": args.repetitions, "maxSteps": args.max_steps, "workerBudgetUsd": args.budget,
            "humanEscalation": "stop immediately; no human intervention during comparison",
            "armOrder": "alternating: court first on odd pairs", "successCriteria": args.success_criteria,
            "limitation": "Worker budget checked between calls; court costs separate. One pair is exploratory, not a statistical result.",
        }, indent=2) + "\n")
        engine = Engine(bus)
        for task in args.tasks:
            for repetition in range(args.repetitions):
                result = engine.compare(configs[task], court_first=repetition % 2 == 0)
                result.update(repetition=repetition + 1, revision=revision, dirtyWorkingTree=dirty,
                              seedDigest=seed_digest(configs[task].seed))
                if args.success_criteria:
                    result["successCriteria"] = args.success_criteria
                results.append(result)
                (out / "runs.json").write_text(json.dumps(results, indent=2) + "\n")
                if args.stripe_sandbox:
                    from courtroom_engine.verification.stripe import evaluate_stripe
                    for arm in ("withCourt", "withoutCourt"):
                        run = result[arm]
                        evidence = Path(run["evidencePath"])
                        if run.get("recoveryChecks", {}).get("status") == "passed":
                            # Persisted comparison and worker IDs make interrupted checks retryable.
                            stripe = evaluate_stripe(evidence / "source", run_id=result["id"] + "-" + run["workerId"],
                                                     secret_key=os.environ.get("STRIPE_TEST_SECRET_KEY", ""))
                        else:
                            stripe = {"status": "not_run", "reason": "Recovery checks did not pass; do not send invalid checkout to Stripe"}
                        run["stripeChecks"] = stripe
                        report_file = evidence / "verification.json"
                        if report_file.exists():
                            verification = json.loads(report_file.read_text())
                            verification["stripeChecks"] = stripe
                            report_file.write_text(json.dumps(verification, indent=2) + "\n")
                    (out / "runs.json").write_text(json.dumps(results, indent=2) + "\n")
                print(f"{task} pair {repetition + 1}: {result['withCourt']['state']} / {result['withoutCourt']['state']} ({result['costMode']})", flush=True)
                # The court quietly runs its $0 mock without a model key; that would fake the savings.
                fake = set(result["withCourt"]["courtModes"]) & {"mock", "stub"}
                if args.brain != "scripted" and fake:
                    sys.exit(f"Court ran in {'/'.join(sorted(fake))} mode, so its cost isn't real. Restart it with "
                             f"ANTHROPIC_API_KEY or GROQ_API_KEY set and COURT_MOCK unset. Partial results: {out}")
    finally:
        bus.close()
        services.close()
    rows = []
    for task in args.tasks:
        for arm in ("withCourt", "withoutCourt"):
            runs = [r[arm] for r in results if r["task"] == task]
            costs = [r["totalCostUsd"] for r in runs if r["totalCostUsd"] is not None]
            rows.append({"task": task, "arm": arm, "runs": len(runs),
                         "engineCompletionRate": sum(r["state"] == "succeeded" for r in runs) / len(runs),
                         "verifiedSuccessRate": None,
                         "recoveryCheckPassRate": (sum(r.get("recoveryChecks", {}).get("status") == "passed" for r in runs) / len(runs)
                                                   if task == "checkout-v2" else None),
                         "stripeCheckPassRate": (sum(r.get("stripeChecks", {}).get("status") == "passed" for r in runs) / len(runs)
                                                 if args.stripe_sandbox else None),
                         "medianCostUsd": statistics.median(costs) if len(costs) == len(runs) else None,
                         "medianElapsedSeconds": statistics.median(r["seconds"] for r in runs),
                         "courtModes": "/".join(sorted({m for r in runs for m in r["courtModes"]})),
                         "costMode": "simulated" if args.brain == "scripted" else "estimated_from_usage"})
    summary = {"pairs": len(results), "rows": rows, "limitation": "Engine completion is not independently verified task success. Scripted comparisons measure the script, not model quality. Checkout-v2 gives both arms equal permissions; legacy coding lets court override restrictions. Sandbox checks are not production certification."}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (out / "summary.csv").open("w") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    review = ["# Benchmark review — pending", "", "Do not infer recovery from engine completion alone.",
              "Review changes, rerun output, and the documented unresolved integration before assigning an outcome.", ""]
    for result in results:
        review += [f"## {result['task']} pair {result['repetition']}", ""]
        for arm in ("withCourt", "withoutCourt"):
            r = result[arm]
            directory = Path(r["evidencePath"]).relative_to(out)
            review += [f"### {arm}: {r['workerId']}", "", f"Engine: {r['state']}. {r.get('summary', '')}",
                       f"Worker cost: {r['workerCostUsd']}; court: {r['courtCostUsd']}; total: {r['totalCostUsd']} ({result['costMode']}).",
                       f"Evidence capture error: {r['evidenceError'] or 'none'}.",
                       f"[Verification record]({directory}/verification.json)"]
            if result["task"] in ("coding", "checkout-v2"):
                review += [f"[Saved source]({directory}/source/) · [Diff]({directory}/changes.diff) · [Fresh test output]({directory}/tests.txt)"]
            else:
                review += [f"[Saved prices and flags]({directory}/prices.json)"]
            review += ["", "Human outcome: **pending**. Evidence and rationale: **pending**.", ""]
    (out / "REVIEW.md").write_text("\n".join(review))
    print(f"Saved raw runs, event history, and JSON/CSV summaries to {out}")


if __name__ == "__main__":
    main()
