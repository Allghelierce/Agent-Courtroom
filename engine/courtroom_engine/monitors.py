"""Cheap code monitors. No LLM calls: each one reads the event log and maybe files a charge.

Each monitor gets only the events since the court last ruled on this worker, so a
verdict gives the worker a clean slate instead of being charged again for old steps.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Optional

from .schema import ChargeKind, Event


@dataclass
class Finding:
    kind: ChargeKind
    summary: str
    eventIds: list[int]


@dataclass
class MonitorConfig:
    loop_repeats: int = 3  # same action + same outcome this many times...
    loop_window: int = 10  # ...within this many steps
    stall_steps: int = 8  # no new passing test in this many steps
    budget_fraction: float = 0.8  # charge once spend passes this share of the budget
    cost_per_test_usd: float = 0.50  # charge when spend per newly passing test is above this
    cost_per_test_min_steps: int = 6
    error_streak: int = 3  # this many tool errors in a row
    same_error_repeats: int = 3  # or the same error this many times in the window


def _action_key(e: Event) -> str:
    # A coding agent reruns the same tests all the time, so (tool, args) alone would fire on
    # healthy work. Including the outcome means only repeats that change nothing count.
    raw = json.dumps([e.tool, e.args, e.result, e.error], sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()


def looping(events: list[Event], cfg: MonitorConfig, budget_usd: float) -> Optional[Finding]:
    window = events[-cfg.loop_window :]
    counts = Counter(_action_key(e) for e in window)
    key, n = counts.most_common(1)[0] if counts else ("", 0)
    if n < cfg.loop_repeats:
        return None
    repeats = [e for e in window if _action_key(e) == key]
    first = repeats[0]
    return Finding(
        "looping",
        f"{first.tool}({json.dumps(first.args, sort_keys=True)}) repeated {n} times in the last "
        f"{len(window)} steps with the same result: {first.error or first.result}",
        [e.id for e in repeats],
    )


def stalling(events: list[Event], cfg: MonitorConfig, budget_usd: float) -> Optional[Finding]:
    if len(events) < cfg.stall_steps:
        return None
    recent = events[-cfg.stall_steps :]
    before = events[-cfg.stall_steps - 1].testsPassing if len(events) > cfg.stall_steps else None
    best_before = before if before is not None else recent[0].testsPassing
    if max(e.testsPassing for e in recent) > best_before:
        return None
    last = recent[-1]
    return Finding(
        "stalling",
        f"Passing tests stuck at {last.testsPassing}/{last.testsTotal} for {cfg.stall_steps} steps",
        [e.id for e in recent],
    )


def overspending(events: list[Event], cfg: MonitorConfig, budget_usd: float) -> Optional[Finding]:
    spent = sum(e.costUsd for e in events)
    if budget_usd > 0 and spent >= cfg.budget_fraction * budget_usd:
        return Finding(
            "overspending",
            f"Spent ${spent:.2f} of the ${budget_usd:.2f} budget since the last ruling",
            [e.id for e in events[-5:]],
        )
    if len(events) < cfg.cost_per_test_min_steps:
        return None
    gained = events[-1].testsPassing - events[0].testsPassing
    if gained <= 0 and spent > cfg.cost_per_test_usd:
        return Finding(
            "overspending",
            f"Spent ${spent:.2f} over {len(events)} steps with no newly passing tests",
            [e.id for e in events[-5:]],
        )
    if gained > 0 and spent / gained > cfg.cost_per_test_usd:
        return Finding(
            "overspending",
            f"${spent / gained:.2f} per newly passing test (limit ${cfg.cost_per_test_usd:.2f})",
            [e.id for e in events[-5:]],
        )
    return None


def flailing(events: list[Event], cfg: MonitorConfig, budget_usd: float) -> Optional[Finding]:
    streak = []
    for e in reversed(events):
        if not e.error:
            break
        streak.append(e)
    if len(streak) >= cfg.error_streak:
        streak.reverse()
        return Finding(
            "flailing",
            f"{len(streak)} tool errors in a row, latest: {streak[-1].error}",
            [e.id for e in streak],
        )
    window = events[-cfg.loop_window :]
    errors = Counter(e.error for e in window if e.error)
    if errors:
        message, n = errors.most_common(1)[0]
        if n >= cfg.same_error_repeats:
            return Finding(
                "flailing",
                f"Same error {n} times in the last {len(window)} steps: {message}",
                [e.id for e in window if e.error == message],
            )
    return None


Monitor = Callable[[list[Event], MonitorConfig, float], Optional[Finding]]

# Checked in this order; the first one that fires files the charge.
ALL_MONITORS: dict[str, Monitor] = {
    "looping": looping,
    "flailing": flailing,
    "stalling": stalling,
    "overspending": overspending,
}
MVP_MONITORS = ("looping", "stalling")


def check(
    events: list[Event], budget_usd: float, enabled=tuple(ALL_MONITORS), cfg: Optional[MonitorConfig] = None
) -> Optional[Finding]:
    cfg = cfg or MonitorConfig()
    for name in enabled:
        if finding := ALL_MONITORS[name](events, cfg, budget_usd):
            return finding
    return None
