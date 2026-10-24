"""What every kind of worker task provides.

The worker loop, monitors, and court only see Events, so they don't care what the task is.
A task supplies the environment the worker acts on, the prompt and tools for Claude, a
scripted run for demos without an API key, and the stub court's advice.

Progress is reported as (passing, total), which fills Event.testsPassing / testsTotal:
tests passing for the coding task, products resolved for the price task.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

Step = tuple[str, dict[str, Any]]


@dataclass
class ToolOutcome:
    output: str  # what the worker sees
    summary: str  # one line for the event log
    error: Optional[str] = None
    progress: Optional[tuple[int, int]] = None  # (passing, total), when this step measured it


class Env(Protocol):
    def baseline(self) -> tuple[int, int]: ...
    def execute(self, tool: str, args: dict[str, Any]) -> ToolOutcome: ...
    def cleanup(self) -> None: ...


@dataclass
class Script:
    """A scripted run: do the plan, then repeat trap_cycle until the court gives an instruction,
    then do recovery and stop."""

    plan: list[Step]
    trap_cycle: list[Step]
    recovery: list[Step]
    trap_text: str = ""
    done_text: str = ""


@dataclass
class Task:
    name: str
    prompt: str  # the worker's first user message
    system_prompt: str
    tools: list[dict[str, Any]]
    stub_instruction: str  # what the stub court tells a stuck worker
    seed: Path
    make_env: Callable[[Path], Env]
    make_script: Callable[[], Script] = field(repr=False, default=None)
