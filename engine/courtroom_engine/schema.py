"""Python mirror of shared/schema.ts. Change both together.

Field names stay camelCase so to_json() output matches the TypeScript types exactly.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

ChargeKind = Literal["looping", "overspending", "stalling", "flailing"]
Ruling = Literal["continue", "change_strategy", "escalate", "halt"]
WorkerState = Literal["running", "on_trial", "awaiting_human", "succeeded", "halted", "failed"]


def _drop_none(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


@dataclass
class Event:
    id: int
    workerId: str
    step: int
    tool: str
    args: dict[str, Any]
    tokens: int
    costUsd: float
    testsPassing: int
    testsTotal: int
    timestamp: str
    error: Optional[str] = None
    result: Optional[str] = None

    def to_json(self) -> dict[str, Any]:
        return _drop_none(asdict(self))


@dataclass
class Charge:
    id: int
    workerId: str
    kind: ChargeKind
    summary: str
    eventIds: list[int]

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Verdict:
    ruling: Ruling
    reasoning: str
    cited_events: list[int] = field(default_factory=list)
    instruction: Optional[str] = None

    def to_json(self) -> dict[str, Any]:
        return _drop_none(asdict(self))

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "Verdict":
        if not isinstance(d, dict):
            raise ValueError("verdict must be an object")
        ruling = d.get("ruling")
        if ruling not in ("continue", "change_strategy", "escalate", "halt"):
            raise ValueError(f"invalid ruling: {ruling!r}")
        instruction = d.get("instruction")
        if instruction is not None and not isinstance(instruction, str):
            raise ValueError("instruction must be a string")
        if ruling == "change_strategy" and not (instruction and instruction.strip()):
            raise ValueError("change_strategy verdict needs an instruction")
        cited = d.get("cited_events", [])
        if not isinstance(cited, list) or any(type(e) is not int for e in cited):
            raise ValueError("cited_events must be an array of integer IDs")
        if not isinstance(d.get("reasoning", ""), str):
            raise ValueError("reasoning must be a string")
        return cls(
            ruling=ruling,
            reasoning=str(d.get("reasoning", "")),
            cited_events=cited,
            instruction=d.get("instruction"),
        )


@dataclass
class WorkerStatus:
    workerId: str
    state: WorkerState
    task: str
    courtEnabled: bool
    step: int
    testsPassing: int
    testsTotal: int
    costUsd: float
    budgetUsd: float
    startedAt: str
    endedAt: Optional[str] = None
    summary: Optional[str] = None
    courtCostUsd: float = 0.0
    courtCostComplete: bool = True
    costMode: str = "simulated"
    workerCostComplete: bool = True

    def to_json(self) -> dict[str, Any]:
        return _drop_none(asdict(self))
