"""What decides the worker's next tool call.

ClaudeBrain is the real agent. ScriptedBrain replays a task's scripted run (do the real work,
then go in circles on the trap) so the whole loop can be demoed and tested without an API
key. Both really execute their tool calls against the task's environment.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .tasks import Task

# USD per million tokens: input, output, cache write (5 min), cache read.
PRICING = {
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
}


def court_order(instruction: str) -> str:
    return f"COURT ORDER: {instruction}"


@dataclass
class Action:
    tool: Optional[str]  # None means the worker says it is done
    args: dict[str, Any] = field(default_factory=dict)
    tokens: int = 0
    cost_usd: float = 0.0
    text: str = ""


class ClaudeBrain:
    def __init__(self, task: Task, model: str = "claude-opus-5-5", effort: str = "medium"):
        import anthropic

        self.client = anthropic.Anthropic()
        self.task = task
        self.model = model
        self.effort = effort
        self.messages: list[dict[str, Any]] = [{"role": "user", "content": task.prompt}]
        self._pending_tool_id: Optional[str] = None

    def _cost(self, usage) -> float:
        price_in, price_out, price_write, price_read = PRICING.get(self.model, PRICING["claude-opus-5-5"])
        return (
            usage.input_tokens * price_in
            + usage.output_tokens * price_out
            + (usage.cache_creation_input_tokens or 0) * price_write
            + (usage.cache_read_input_tokens or 0) * price_read
        ) / 1_000_000

    def next_action(self) -> Action:
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=self.task.system_prompt,
            tools=self.task.tools,
            # One tool call per step keeps one event per step.
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            messages=self.messages,
            output_config={"effort": self.effort},
            cache_control={"type": "ephemeral"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        usage = response.usage
        tokens = (
            usage.input_tokens
            + usage.output_tokens
            + (usage.cache_creation_input_tokens or 0)
            + (usage.cache_read_input_tokens or 0)
        )
        cost = self._cost(usage)
        # Append the full content (thinking blocks included) so the history stays append-only.
        self.messages.append({"role": "assistant", "content": response.content})
        text = " ".join(b.text for b in response.content if b.type == "text").strip()

        if response.stop_reason == "refusal":
            return Action(tool=None, tokens=tokens, cost_usd=cost, text=f"refused: {text}")
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if tool_use is None:
            return Action(tool=None, tokens=tokens, cost_usd=cost, text=text)
        self._pending_tool_id = tool_use.id
        return Action(tool=tool_use.name, args=dict(tool_use.input), tokens=tokens, cost_usd=cost, text=text)

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None) -> None:
        content: list[dict[str, Any]] = [
            {"type": "tool_result", "tool_use_id": self._pending_tool_id, "content": output, "is_error": is_error}
        ]
        if instruction:
            content.append({"type": "text", "text": court_order(instruction)})
        self.messages.append({"role": "user", "content": content})


class ScriptedBrain:
    """Deterministic stand-in for Claude with a simulated, growing token cost per step."""

    def __init__(self, task: Task, model: str = "claude-opus-5-5", step_delay: float = 0.0):
        self.step_delay = step_delay  # seconds per step, so a live dashboard has something to watch
        self.price_in, self.price_out, _, _ = PRICING.get(model, PRICING["claude-opus-5-5"])
        self.script = task.make_script()
        self.plan = list(self.script.plan)
        self.steps = 0
        self.trap_index = 0
        self.recovering: list[tuple[str, dict[str, Any]]] = []
        self.finished = False

    def _priced(self, tool: Optional[str], args: dict[str, Any], text: str = "") -> Action:
        time.sleep(self.step_delay)
        self.steps += 1
        # Context grows every step, like a real agent resending its history.
        tokens_in = 3000 + 1100 * self.steps
        tokens_out = 350
        cost = (tokens_in * self.price_in + tokens_out * self.price_out) / 1_000_000
        return Action(tool=tool, args=args, tokens=tokens_in + tokens_out, cost_usd=cost, text=text)

    def next_action(self) -> Action:
        if self.finished:
            return self._priced(None, {}, self.script.done_text)
        if self.plan:
            tool, args = self.plan.pop(0)
            return self._priced(tool, args)
        if self.recovering:
            tool, args = self.recovering.pop(0)
            if not self.recovering:
                self.finished = True
            return self._priced(tool, args)
        tool, args = self.script.trap_cycle[self.trap_index % len(self.script.trap_cycle)]
        self.trap_index += 1
        return self._priced(tool, args, self.script.trap_text)

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None) -> None:
        if not instruction or self.recovering or self.finished:
            return
        self.plan = []
        self.recovering = list(self.script.recovery)
