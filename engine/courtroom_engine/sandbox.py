"""A throwaway copy of a seed repo plus the tools the worker can call on it."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

TEST_LINE = re.compile(r"^(\w+) \(.+?\) \.\.\. (ok|FAIL|ERROR|skipped.*|expected failure|unexpected success)$")
RAN_LINE = re.compile(r"^Ran (\d+) tests?")


@dataclass
class ToolOutcome:
    output: str  # what the worker sees
    summary: str  # one line for the event log
    error: Optional[str] = None
    tests: Optional[tuple[int, int]] = None  # (passing, total) after run_tests
    failing: Optional[list[str]] = None


class Sandbox:
    def __init__(self, seed_repo: Path):
        self.root = Path(tempfile.mkdtemp(prefix="courtroom-")) / seed_repo.name
        shutil.copytree(seed_repo, self.root, ignore=shutil.ignore_patterns("__pycache__"))

    def cleanup(self) -> None:
        shutil.rmtree(self.root.parent, ignore_errors=True)

    def _resolve(self, path: str) -> Path:
        target = (self.root / path).resolve()
        if not target.is_relative_to(self.root.resolve()):
            raise ValueError(f"path escapes the repo: {path}")
        return target

    def execute(self, tool: str, args: dict[str, Any]) -> ToolOutcome:
        try:
            if tool == "list_files":
                return self.list_files()
            if tool == "read_file":
                return self.read_file(args["path"])
            if tool == "edit_file":
                return self.edit_file(args["path"], args["old_str"], args["new_str"])
            if tool == "run_tests":
                return self.run_tests()
            raise ValueError(f"unknown tool: {tool}")
        except (ValueError, KeyError, OSError) as e:
            message = f"{type(e).__name__}: {e}"
            return ToolOutcome(output=message, summary=message, error=message)

    def list_files(self) -> ToolOutcome:
        files = sorted(
            str(p.relative_to(self.root))
            for p in self.root.rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        )
        return ToolOutcome(output="\n".join(files), summary=f"{len(files)} files")

    def read_file(self, path: str) -> ToolOutcome:
        text = self._resolve(path).read_text()
        return ToolOutcome(output=text, summary=f"read {len(text.splitlines())} lines")

    def edit_file(self, path: str, old_str: str, new_str: str) -> ToolOutcome:
        target = self._resolve(path)
        if old_str == "" and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(new_str)
            return ToolOutcome(output=f"created {path}", summary=f"created {path}")
        text = target.read_text()
        count = text.count(old_str)
        if count != 1:
            raise ValueError(f"old_str must appear exactly once in {path}, found {count}")
        target.write_text(text.replace(old_str, new_str, 1))
        return ToolOutcome(output=f"edited {path}", summary=f"edited {path}")

    def run_tests(self) -> ToolOutcome:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=120,
            )
            output = proc.stdout + proc.stderr
        except subprocess.TimeoutExpired:
            message = "test run timed out after 120s"
            return ToolOutcome(output=message, summary=message, error=message, tests=(0, 0), failing=[])

        passing, failing, total = 0, [], 0
        for line in output.splitlines():
            if m := TEST_LINE.match(line):
                if m.group(2) == "ok":
                    passing += 1
                else:
                    failing.append(m.group(1))
            elif m := RAN_LINE.match(line):
                total = int(m.group(1))
        summary = f"{passing}/{total} passing"
        if failing:
            summary += "; failing: " + ", ".join(sorted(failing))
        # The worker sees the tail, where the tracebacks and totals are.
        return ToolOutcome(output=output[-6000:], summary=summary, tests=(passing, total), failing=failing)
