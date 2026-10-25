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
from .costs import model_rates, price_usage

GROQ_OUTPUT_BUDGET_CHARS = 12000  # recent tool output the Groq worker sees in full (~3K tokens)
GROQ_MAX_OUTPUT_CHARS = 3000  # cap on any single tool output

DEFAULT_MODELS = {"claude": "claude-opus-5-5", "groq": "openai/gpt-oss-120b", "scripted": "claude-opus-5-5"}


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
    error: Optional[str] = None  # the model asked for a tool call the API couldn't parse


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

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None, summary: str = "") -> None:
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
        self.client = groq.Groq(max_retries=5, timeout=90.0)  # preserve A's free-tier retry behavior
        self.task = task
        self.model = model
        rates = model_rates(model)
        if rates is None:
            raise ValueError(f"No price for model {model}; update shared/model-prices.json")
        self.price_in, self.price_out, self.price_cached = rates[0], rates[1], rates[4]
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
        self._pending_key = ""
        # (index in messages, tool + args, one-line summary) for every tool output, oldest first
        self._outputs: list[tuple[int, str, str]] = []

    def _request_messages(self) -> list[dict[str, Any]]:
        # Groq's free tier caps tokens per minute (8K for gpt-oss-120b), so a history that resends
        # every file and test log soon can't fit in one request. Going newest first, outputs stay
        # whole until the budget runs out; older ones, and older copies of a repeated call, shrink
        # to their one-line summary.
        trimmed, seen, used = {}, set(), 0
        for i, key, summary in reversed(self._outputs):
            size = len(self.messages[i]["content"])
            if key in seen or used + size > GROQ_OUTPUT_BUDGET_CHARS:
                trimmed[i] = summary
            else:
                used += size
            seen.add(key)
        return [
            {**m, "content": f"[older output trimmed] {trimmed[i]}"} if i in trimmed else m
            for i, m in enumerate(self.messages)
        ]

    def _cost(self, prompt_tokens: int, completion_tokens: int, cached_tokens: int = 0) -> float:
        return ((prompt_tokens - cached_tokens) * self.price_in + cached_tokens * self.price_cached
                + completion_tokens * self.price_out) / 1_000_000

    def _failed_call(self, e, request: list[dict[str, Any]]) -> Action:
        # Retain a rough estimate for the budget meter when errors omit usage. It is
        # not provider-reported usage: mark totals incomplete instead of claiming savings.
        body = getattr(e, "body", None)
        error = body.get("error", body) if isinstance(body, dict) else {}
        generated = (error.get("failed_generation") if isinstance(error, dict) else None) or ""
        prompt_tokens = len(json.dumps(request)) // 4 + len(json.dumps(self.tools)) // 4
        completion_tokens = len(generated) // 4
        return Action(tool="invalid_tool_call", error=f"Malformed tool call: {str(e)[:300]}", model=self.model,
                      tokens=prompt_tokens + completion_tokens, cost_usd=self._cost(prompt_tokens, completion_tokens),
                      usage={"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "estimated": True},
                      cost_complete=False)

    def next_action(self) -> Action:
        request = self._request_messages()
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=request,
                tools=self.tools,
                tool_choice="auto",
                max_completion_tokens=4096,  # may count against the per-minute token limit
            )
        except self.groq.BadRequestError as e:
            # Groq rejects tool calls the model wrote as invalid JSON. Log it as a failed step so
            # the flailing monitor can see a model that keeps doing it.
            body = getattr(e, "body", None)
            error = body.get("error", body) if isinstance(body, dict) else {}
            code = error.get("code") if isinstance(error, dict) else None
            if code not in ("tool_use_failed", "output_parse_failed") and "tool_use_failed" not in str(e):
                raise
            self._pending = None
            return self._failed_call(e, request)
        except self.groq.APIStatusError as e:
            if e.status_code == 413:
                raise RuntimeError(f"Request too large for Groq's per-minute token limit: {e}") from e
            raise

        usage = response.usage
        details = getattr(usage, "prompt_tokens_details", None)
        cost = self._cost(usage.prompt_tokens, usage.completion_tokens, getattr(details, "cached_tokens", None) or 0)
        accounting = {"usage": usage.model_dump(), "model": response.model, "cost_complete": response.model == self.model}
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
            return Action(tool=None, tokens=usage.total_tokens, cost_usd=cost, text=text, **accounting)

        # One tool call per step. Every call still needs a reply, so the extras are declined.
        first, extras = calls[0], calls[1:]
        for c in extras:
            self.messages.append({
                "role": "tool",
                "tool_call_id": c.id,
                "content": "Not run: make one tool call at a time. Ask for it again if you still need it.",
            })
        self._pending = first.id
        self._pending_key = f"{first.function.name} {first.function.arguments}"
        try:
            args = json.loads(first.function.arguments or "{}")
            if not isinstance(args, dict):
                raise ValueError("arguments must be a JSON object")
        except ValueError as e:
            return Action(tool=first.function.name, tokens=usage.total_tokens, cost_usd=cost, text=text,
                          error=f"Tool arguments were not valid JSON: {e}", **accounting)
        return Action(tool=first.function.name, args=args, tokens=usage.total_tokens, cost_usd=cost, text=text, **accounting)

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None, summary: str = "") -> None:
        if self._pending:
            self._outputs.append((len(self.messages), self._pending_key, summary or output[:200]))
            if len(output) > GROQ_MAX_OUTPUT_CHARS:
                output = "[start trimmed]\n" + output[-GROQ_MAX_OUTPUT_CHARS:]
            self.messages.append({"role": "tool", "tool_call_id": self._pending, "content": output})
        else:
            self.messages.append({"role": "user", "content": f"{output}\nTry again with a valid tool call."})
        if instruction:
            self.messages.append({"role": "user", "content": court_order(instruction)})


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

    def observe(self, output: str, is_error: bool, instruction: Optional[str] = None, summary: str = "") -> None:
        if not instruction or self.recovering or self.finished:
            return
        self.plan = []
        self.recovering = list(self.script.recovery)
