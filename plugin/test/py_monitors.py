"""Reference findings from the engine's own monitors, for test/monitors.test.ts.

stdin: {"budgetUsd": float, "events": [Event, ...]}
stdout: one finding (or null) per step, checking events[:i] for i = 1..n.
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))
from courtroom_engine import monitors  # noqa: E402
from courtroom_engine.schema import Event  # noqa: E402

data = json.load(sys.stdin)
events = [Event(**{k: v for k, v in e.items() if k in Event.__dataclass_fields__}) for e in data["events"]]
out = []
for i in range(1, len(events) + 1):
    f = monitors.check(events[:i], data["budgetUsd"])
    out.append(f and {"kind": f.kind, "summary": f.summary, "eventIds": f.eventIds})
print(json.dumps(out))
