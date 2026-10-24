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
from .costs import model_rates, price_usage


def court_order(instruction: str) -> str:
    return f"COURT ORDER: {instruction}"


@dataclass
class Action:
    tool: Optional[str]  # None means the worker says it is done
    args: dict[str, Any] = field(default_factory=dict)
    tokens: int = 0
    cost_usd: float = 0.0
    text: str = ""
    usage: dict[str, Any] = field(default_factory=dict)
    model: str = "scripted"
    cost_complete: bool = True


class ClaudeBrain:
    def __init__(self, task: Task, model: str = "claude-opus-5-5", effort: str = "medium"):
        import anthropic

        self.client = anthropic.Anthropic(max_retries=0, timeout=60.0)
        self.task = task
        self.model = model
        self.effort = effort
        self.messages: list[dict[str, Any]] = [{"role": "user", "content": task.prompt}]
        self._pending_tool_id: Optional[str] = None

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
        usage_record = usage.model_dump()
        cost = price_usage(response.model, usage_record)
        accounting = {"usage": usage_record, "model": response.model, "cost_complete": cost is not None}
        # Append the full content (thinking blocks included) so the history stays append-only.
        self.messages.append({"role": "assistant", "content": response.content})
        text = " ".join(b.text for b in response.content if b.type == "text").strip()

        if response.stop_reason == "refusal":
            return Action(tool=None, tokens=tokens, cost_usd=cost or 0, text=f"refused: {text}", **accounting)
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if tool_use is None:
            return Action(tool=None, tokens=tokens, cost_usd=cost or 0, text=text, **accounting)
        self._pending_tool_id = tool_use.id
        return Action(tool=tool_use.name, args=dict(tool_use.input), tokens=tokens, cost_usd=cost or 0, text=text, **accounting)

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
        rates = model_rates(model)
        if rates is None:
            raise ValueError(f"No simulation price for model {model}")
        self.price_in, self.price_out = rates[:2]
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
