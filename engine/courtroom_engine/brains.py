"""What decides the worker's next tool call.

ClaudeBrain and GroqBrain are real agents. ScriptedBrain replays a task's scripted run (do the real work,
then go in circles on the trap) so the whole loop can be demoed and tested without an API
key. Both really execute their tool calls against the task's environment.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .tasks import Task

# USD per million tokens: input, output, cache write (5 min), cache read.
PRICING = {
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
    # Groq lists these two; cached input is billed at the full input rate here to stay conservative.
    "openai/gpt-oss-120b": (0.15, 0.60, 0.15, 0.15),
    "openai/gpt-oss-20b": (0.075, 0.30, 0.075, 0.075),
}
DEFAULT_MODELS = {"claude": "claude-opus-5-5", "groq": "openai/gpt-oss-120b", "scripted": "claude-opus-5-5"}


def prices(model: str) -> tuple[float, float, float, float]:
    if model not in PRICING:
        raise ValueError(f"no price for {model}; add it to PRICING in brains.py")
    return PRICING[model]


def court_order(instruction: str) -> str:
    return f"COURT ORDER: {instruction}"


@dataclass
class Action:
    tool: Optional[str]  # None means the worker says it is done
    args: dict[str, Any] = field(default_factory=dict)
    tokens: int = 0
    cost_usd: float = 0.0
    text: str = ""
    error: Optional[str] = None  # the model asked for a tool call the API couldn't parse


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
        price_in, price_out, price_write, price_read = prices(self.model)
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


class GroqBrain:
    """The same agent on Groq's chat completions API (OpenAI-style tool calls)."""

    def __init__(self, task: Task, model: str = "openai/gpt-oss-120b"):
        import groq

        self.groq = groq
        self.client = groq.Groq(max_retries=5)  # the free tier rate-limits; the SDK backs off and retries
        self.task = task
        self.model = model
        self.price_in, self.price_out, _, _ = prices(model)
        self.tools = [
            {
                "type": "function",
                "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]},
            }
            for t in task.tools
        ]
        self.messages: list[dict[str, Any]] = [
            {"role": "system", "content": task.system_prompt},
            {"role": "user", "content": task.prompt},
        ]
        self._pending: Optional[str] = None  # id of the tool call we executed this step

    def next_action(self) -> Action:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=self.tools,
                tool_choice="auto",
                max_completion_tokens=8192,
            )
        except self.groq.BadRequestError as e:
            # Groq rejects tool calls the model wrote as invalid JSON. Log it as a failed step so
            # the flailing monitor can see a model that keeps doing it.
            if "tool_use_failed" not in str(e):
                raise
            self._pending = None
            return Action(tool="invalid_tool_call", error=f"Malformed tool call: {str(e)[:300]}")

        usage = response.usage
        cost = (usage.prompt_tokens * self.price_in + usage.completion_tokens * self.price_out) / 1_000_000
        message = response.choices[0].message
        calls = message.tool_calls or []
        self.messages.append({
            "role": "assistant",
            "content": message.content or "",
            **({"tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls
            ]} if calls else {}),
        })
        text = (message.content or "").strip()
        if not calls:
            return Action(tool=None, tokens=usage.total_tokens, cost_usd=cost, text=text)

        # One tool call per step. Every call still needs a reply, so the extras are declined.
        first, extras = calls[0], calls[1:]
        for c in extras:
            self.messages.append({
                "role": "tool",
                "tool_call_id": c.id,
                "content": "Not run: make one tool call at a time. Ask for it again if you still need it.",
            })
        self._pending = first.id
        try:
            args = json.loads(first.function.arguments or "{}")
            if not isinstance(args, dict):
                raise ValueError("arguments must be a JSON object")
        except ValueError as e:
            return Action(tool=first.function.name, tokens=usage.total_tokens, cost_usd=cost, text=text,
                          error=f"Tool arguments were not valid JSON: {e}")
        return Action(tool=first.function.name, args=args, tokens=usage.total_tokens, cost_usd=cost, text=text)

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None) -> None:
        if self._pending:
            self.messages.append({"role": "tool", "tool_call_id": self._pending, "content": output})
        else:
            self.messages.append({"role": "user", "content": f"{output}\nTry again with a valid tool call."})
        if instruction:
            self.messages.append({"role": "user", "content": court_order(instruction)})


class ScriptedBrain:
    """Deterministic stand-in for Claude with a simulated, growing token cost per step."""

    def __init__(self, task: Task, model: str = "claude-opus-5-5", step_delay: float = 0.0):
        self.step_delay = step_delay  # seconds per step, so a live dashboard has something to watch
        self.price_in, self.price_out, _, _ = prices(model)
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
