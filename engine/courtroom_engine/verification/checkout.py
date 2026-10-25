"""Parent-owned evaluation and integrity checks, independent of worker progress."""

import json
import os
import subprocess
import sys
from pathlib import Path


def evaluate(source: Path, seed: Path, *, heldout: bool = True) -> dict:
    source, seed = source.resolve(), seed.resolve()
    checks = []
    expected = {p.relative_to(seed / "tests"): p.read_bytes() for p in (seed / "tests").rglob("*.py")}
    actual = {p.relative_to(source / "tests"): p.read_bytes() for p in (source / "tests").rglob("*.py")}
    checks.append({"name": "original_tests_unchanged", "passed": expected == actual,
                   "detail": "Original tests must remain unchanged; use recovery.json for a test-only mock."})
    try:
        proc = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).with_name("checkout_child.py")),
                               str(source), str(seed), "heldout" if heldout else "public"],
                              cwd=source, env={k: v for k, v in os.environ.items() if k in ("PATH", "SYSTEMROOT", "TMPDIR")},
                              capture_output=True, text=True, timeout=30)
        report = json.loads(proc.stdout)
        expected_count = 21 if heldout else 19
        if proc.returncode != 0 or "error" in report or len(report.get("checks", [])) != expected_count:
            raise ValueError(report.get("error", "Incomplete grader output"))
        checks.extend(report["checks"])
        state = "passed" if all(c["passed"] for c in checks) else "failed"
        return {"status": state, "profile": "checkout-v2", "heldout": heldout, "checks": checks,
                "passing": sum(c["passed"] for c in checks), "total": len(checks)}
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "profile": "checkout-v2", "heldout": heldout, "checks": checks,
                "passing": 0, "total": 22 if heldout else 20, "error": f"{type(exc).__name__}: {exc}"[:800]}


def describe(report: dict) -> str:
    failures = [f"{c['name']}: {c.get('detail', 'failed')}" for c in report["checks"] if not c["passed"]]
    return (f"{report['passing']}/{report['total']} checks passing ({report['status']})\n"
            + "\n".join(failures) + ("\n" + report["error"] if "error" in report else ""))
