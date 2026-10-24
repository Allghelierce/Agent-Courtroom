"""Save reviewable task outputs before the worker's temporary environment is removed."""

import difflib
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def source_files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and not p.is_symlink()
            and not any(part in ("__pycache__", ".git", ".venv") for part in p.relative_to(root).parts)
            and p.suffix != ".pyc"}


def capture(env, seed: Path, destination: Path, task_name: str) -> dict:
    destination.mkdir(parents=True, exist_ok=False)
    report = {"task": task_name, "outcomeVerified": False, "reviewStatus": "pending human diff review"}
    if task_name == "coding":
        before, after = source_files(seed), source_files(env.root)
        saved = destination / "source"
        saved.mkdir()
        for name, data in after.items():
            target = saved / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        patches, changed = [], []
        for name in sorted(before.keys() | after.keys()):
            if before.get(name) == after.get(name):
                continue
            changed.append(name)
            patches.extend(difflib.unified_diff(
                before.get(name, b"").decode("utf-8", errors="replace").splitlines(keepends=True),
                after.get(name, b"").decode("utf-8", errors="replace").splitlines(keepends=True),
                fromfile=f"seed/{name}", tofile=f"result/{name}"))
        (destination / "changes.diff").write_text("".join(patches))
        report.update(changedFiles=changed, sourceSha256={name: hashlib.sha256(data).hexdigest() for name, data in after.items()})
        # Run the retained result afresh, outside the worker's progress counters. A passing
        # modified suite still needs human review for removed/weakened assertions.
        command = [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]
        try:
            proc = subprocess.run(command, cwd=saved, capture_output=True, text=True, timeout=120)
            (destination / "tests.txt").write_text(proc.stdout + proc.stderr)
            report.update(testExitCode=proc.returncode, testCommand=command, testTimedOut=False)
        except subprocess.TimeoutExpired as exc:
            output = (exc.stdout or b"") + (exc.stderr or b"")
            (destination / "tests.txt").write_text(output.decode(errors="replace") + "\nVerification timed out after 120 seconds.\n")
            report.update(testExitCode=None, testCommand=command, testTimedOut=True)
    elif task_name == "prices":
        (destination / "prices.json").write_text(json.dumps({"saved": env.saved, "flagged": env.flagged}, indent=2) + "\n")
        report["progress"] = list(env.baseline())
    else:
        raise ValueError(f"No evidence capture for task {task_name}")
    (destination / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    return report
