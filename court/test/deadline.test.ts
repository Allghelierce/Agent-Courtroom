import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type Groq from "groq-sdk";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

// court.ts reads the deadline when it loads, so set it first and import it after.
// The test runner gives each file its own process, so this doesn't leak into other tests.
process.env.COURT_DEADLINE_MS = "50";
const { holdTrial } = await import("../src/court.ts");

const run = loadFixture();
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });

// A call that only ends when the court's signal aborts, like a real SDK request that never answers.
// Like the SDKs, it rejects at once if the signal has already aborted.
function hang(seen: AbortSignal[]) {
  return (_body: unknown, opts?: { signal?: AbortSignal }) => {
    const signal = opts?.signal;
    assert.ok(signal, "the court passes an AbortSignal to every model call");
    seen.push(signal);
    return new Promise((_, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
}

// Fails instead of hanging if the deadline never fires. The 50s default would trip it too,
// so passing also shows COURT_DEADLINE_MS took effect.
async function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`trial still running after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function assertTimedOut(trial: Awaited<ReturnType<typeof holdTrial>>) {
  for (const a of [trial.prosecution, trial.defense]) {
    assert.match(a.argument, /rests without argument/);
    assert.deepEqual(a.cited_events, []);
    assert.equal(a.costComplete, false);
  }
  assert.equal(trial.verdict.ruling, "escalate");
  assert.match(trial.verdict.reasoning, /could not reach a verdict.*(timeout|TimeoutError|abort)/i);
  assert.equal(trial.costUsd, 0);
  assert.equal(trial.costComplete, false);
}

test("deadline (anthropic): lawyers rest, the judge escalates, and the trial still returns", async () => {
  const seen: AbortSignal[] = [];
  const client = { messages: { parse: hang(seen) }, beta: { messages: { parse: hang(seen) } } } as unknown as Anthropic;
  const t0 = performance.now();
  const trial = await within(2000, holdTrial(packet, { mock: false, client }));
  const ms = performance.now() - t0;
  assertTimedOut(trial);
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 1, "one deadline covers the whole trial");
  assert.ok(ms >= 40, `returned after ${ms.toFixed(0)}ms, before the 50ms deadline`);
});

test("deadline (groq): lawyers rest, the judge escalates, and the trial still returns", async () => {
  const seen: AbortSignal[] = [];
  const groq = { chat: { completions: { create: hang(seen) } } } as unknown as Groq;
  const trial = await within(2000, holdTrial(packet, { mock: false, groq }));
  assertTimedOut(trial);
  assert.equal(seen.length, 3);
});

test("deadline hits only the judge: it escalates and the lawyers' costs still count", async () => {
  const seen: AbortSignal[] = [];
  const lawyer = async () => ({
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 200 },
    parsed_output: { argument: "It loops.", cited_events: [run.charge.eventIds[0]], recommended_ruling: "change_strategy" },
  });
  const client = { messages: { parse: lawyer }, beta: { messages: { parse: hang(seen) } } } as unknown as Anthropic;
  const trial = await within(2000, holdTrial(packet, { mock: false, client }));
  assert.equal(trial.prosecution.argument, "It loops.");
  assert.equal(trial.prosecution.costComplete, true);
  assert.equal(trial.verdict.ruling, "escalate");
  assert.equal(trial.costComplete, false);
  assert.ok(trial.costUsd > 0);
  assert.equal(trial.costUsd, Math.round((trial.prosecution.costUsd + trial.defense.costUsd) * 1e6) / 1e6);
});
