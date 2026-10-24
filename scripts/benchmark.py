"""Run paired tasks through the existing engine; keep raw results and export a summary."""

import argparse
import csv
import hashlib
import json
import os
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from courtroom_engine.bus import Bus
from courtroom_engine.engine import Engine, RunConfig


def seed_digest(path: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(path.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts:
            digest.update(str(file.relative_to(path)).encode())
            digest.update(file.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", nargs="+", choices=("coding", "prices"), default=["coding", "prices"])
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--court", default="http://127.0.0.1:4100/verdict")
    parser.add_argument("--brain", choices=("scripted", "claude", "groq"), default="scripted")
    parser.add_argument("--model", help="Defaults to the selected provider's worker model")
    parser.add_argument("--budget", type=float, default=2.0)
    parser.add_argument("--max-steps", type=int, default=30)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--success-criteria", help="Human-approved evaluation definition, recorded verbatim")
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 20:
        parser.error("--repetitions must be between 1 and 20")
    if args.brain != "scripted":
        key = "GROQ_API_KEY" if args.brain == "groq" else "ANTHROPIC_API_KEY"
        if not args.success_criteria or not os.environ.get(key):
            parser.error(f"Real comparisons require --success-criteria and {key}")
        if not args.court.startswith(("http://", "https://")):
            parser.error("Real comparisons need the HTTP court; the stub court's $0 cost isn't a real overhead")
    configs = {task: RunConfig(task=task, brain=args.brain, model=args.model, court=args.court,
                               budget_usd=args.budget, max_steps=args.max_steps) for task in args.tasks}
    try:
        for cfg in configs.values():
            cfg.validate()
    except ValueError as e:
        parser.error(str(e))
    out = args.output or ROOT / "runs/benchmarks" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    out.mkdir(parents=True, exist_ok=False)
    bus = Bus(record_path=out / "events.jsonl", db_path=out / "events.sqlite")
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True).strip())
    except (OSError, subprocess.SubprocessError):
        revision, dirty = "unavailable", True
    results = []
    try:
        engine = Engine(bus)
        for task in args.tasks:
            for repetition in range(args.repetitions):
                result = engine.compare(configs[task])
                result.update(repetition=repetition + 1, revision=revision, dirtyWorkingTree=dirty,
                              seedDigest=seed_digest(ROOT / "seed_repos" / ("checkout" if task == "coding" else "price_watch")))
                if args.success_criteria:
                    result["successCriteria"] = args.success_criteria
                results.append(result)
                (out / "runs.json").write_text(json.dumps(results, indent=2) + "\n")
                print(f"{task} pair {repetition + 1}: {result['withCourt']['state']} / {result['withoutCourt']['state']} ({result['costMode']})", flush=True)
                # The court quietly runs its $0 mock without an Anthropic key; that would fake the savings.
                fake = set(result["withCourt"]["courtModes"]) & {"mock", "stub"}
                if args.brain != "scripted" and fake:
                    sys.exit(f"Court ran in {'/'.join(sorted(fake))} mode, so its cost isn't real. Restart it with "
                             f"ANTHROPIC_API_KEY set and COURT_MOCK unset. Partial results: {out}")
    finally:
        bus.close()
    rows = []
    for task in args.tasks:
        for arm in ("withCourt", "withoutCourt"):
            runs = [r[arm] for r in results if r["task"] == task]
            costs = [r["totalCostUsd"] for r in runs if r["totalCostUsd"] is not None]
            rows.append({"task": task, "arm": arm, "runs": len(runs),
                         "engineCompletionRate": sum(r["state"] == "succeeded" for r in runs) / len(runs),
                         "verifiedSuccessRate": None,
                         "medianCostUsd": statistics.median(costs) if len(costs) == len(runs) else None,
                         "medianElapsedSeconds": statistics.median(r["seconds"] for r in runs),
                         "courtModes": "/".join(sorted({m for r in runs for m in r["courtModes"]})),
                         "costMode": "simulated" if args.brain == "scripted" else "estimated_from_usage"})
    summary = {"pairs": len(results), "rows": rows, "limitation": "Engine completion is not independently verified task success. Scripted comparisons measure the script, not model quality. Court-enabled prompts can override task restrictions."}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (out / "summary.csv").open("w") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Saved raw runs, event history, and JSON/CSV summaries to {out}")


if __name__ == "__main__":
    main()
