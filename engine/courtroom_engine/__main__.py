"""Command line: python -m courtroom_engine {run,compare,serve} [options]"""

from __future__ import annotations

import argparse
import json
import threading
from datetime import datetime
from pathlib import Path

from .bus import Bus
from .engine import REPO_ROOT, Engine, RunConfig
from .tasks import TASKS
from .server import serve

RUNS_DIR = REPO_ROOT / "runs"


def print_message(message: dict) -> None:
    kind, data = message["type"], message["data"]
    if kind == "event":
        error = f"  ERROR {data['error']}" if data.get("error") else ""
        args = json.dumps(data["args"])
        if len(args) > 60:
            args = args[:57] + "..."
        print(
            f"  [{data['workerId']}] #{data['id']:<3} step {data['step']:<3} {data['tool']:<10} {args:<60} "
            f"{data['testsPassing']}/{data['testsTotal']}  ${data['costUsd']:.4f}{error}"
        )
    elif kind == "charge":
        print(f"! [{data['workerId']}] CHARGE #{data['id']} {data['kind']}: {data['summary']}")
    elif kind == "verdict":
        v = data["verdict"]
        print(f"⚖ [{data['workerId']}] VERDICT {v['ruling']}: {v.get('instruction') or v['reasoning']}")
    elif kind == "worker" and data["state"] not in ("running",):
        print(f"* [{data['workerId']}] {data['state']}" + (f": {data['summary']}" if data.get("summary") else ""))


def console_printer(bus: Bus) -> None:
    _, q = bus.subscribe()

    def loop():
        while True:
            print_message(q.get())

    threading.Thread(target=loop, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(prog="courtroom_engine")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "compare", "serve"):
        p = sub.add_parser(name)
        p.add_argument("--task", default="coding", choices=list(TASKS), help="which kind of worker")
        p.add_argument("--brain", default="scripted", choices=["scripted", "claude", "groq"])
        p.add_argument("--court", default="stub", help='"stub", "none", or a convene URL')
        p.add_argument("--model", help="worker model; defaults to claude-opus-5-5 or openai/gpt-oss-120b on groq")
        p.add_argument("--budget", type=float, default=2.0, help="USD per worker")
        p.add_argument("--max-steps", type=int, default=60)
        p.add_argument("--all-monitors", action="store_true", help="also run overspending and flailing")
        p.add_argument("--seed", type=Path, help="override the task's seed repo or data")
        p.add_argument("--step-delay", type=float, default=1.0 if name == "serve" else 0.0,
                       help="seconds per scripted step (default 1 for serve, 0 otherwise)")
        p.add_argument("--record", type=Path, help="write every stream message to this .jsonl file")
        if name == "serve":
            p.add_argument("--host", default="127.0.0.1")
            p.add_argument("--port", type=int, default=8787)
            p.add_argument("--workers", type=int, default=0, help="start this many workers right away")
    args = parser.parse_args()

    cfg = RunConfig(
        task=args.task,
        brain=args.brain,
        court=args.court,
        model=args.model,
        budget_usd=args.budget,
        max_steps=args.max_steps,
        all_monitors=args.all_monitors,
        step_delay=args.step_delay,
        seed=args.seed.resolve() if args.seed else None,
    )
    record = args.record or RUNS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}-{args.command}.jsonl"
    bus = Bus(record_path=record)
    engine = Engine(bus)
    console_printer(bus)

    if args.command == "run":
        worker = engine.create_worker(cfg)
        status = worker.run()
        print(f"\nRecorded to {record}")
        raise SystemExit(0 if status.state == "succeeded" else 1)

    if args.command == "compare":
        result = engine.compare(cfg)
        print("\n                 with court    without court")
        for label, key in (("outcome", "state"), ("tests passing", None), ("steps", "step"),
                           ("cost (USD)", "costUsd"), ("seconds", "seconds")):
            row = []
            for side in ("withCourt", "withoutCourt"):
                s = result[side]
                if key is None:
                    row.append(f"{s['testsPassing']}/{s['testsTotal']}")
                elif key == "costUsd":
                    row.append(f"${s[key]:.2f}")
                else:
                    row.append(str(s[key]))
            print(f"  {label:<14} {row[0]:<13} {row[1]}")
        out = RUNS_DIR / "comparison.json"
        out.write_text(json.dumps(result, indent=2))
        print(f"\nWrote {out}\nRecorded to {record}")
        return

    for _ in range(args.workers):
        engine.start_worker(cfg)
    serve(engine, cfg, args.host, args.port)


if __name__ == "__main__":
    main()
