import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { holdTrial } from "../src/court.ts";
import { buildPacket, fromEnginePacket } from "../src/packet.ts";
import { rulesConfig, summaryJudgment, type RulesConfig } from "../src/rules.ts";
import type { EnginePacket, Ruling, Trial } from "../src/types.ts";
import { loadFixture } from "./helpers.ts";

const run = loadFixture();
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });
const worker = packet.workerId;

// All times are relative to the run's start, so nothing depends on the real clock.
const MIN = 60_000;
const runStart = Date.parse(packet.runSince!);
const NOW = runStart + 2 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

const CFG: RulesConfig = { enabled: true, budgetFraction: 0.05, budgetFloorUsd: 0.05, maxTrialsPerHour: 6, repeatWindowMin: 30 };

// An earlier trial in the case log, `minutesAgo` before NOW.
function past(id: string, minutesAgo: number, ruling: Ruling, extra: Partial<Trial> = {}): Trial {
  const at = iso(NOW - minutesAgo * MIN);
  const arg = (side: "prosecution" | "defense") => ({ side, model: "mock", argument: "", cited_events: [], costUsd: 0 });
  return {
    id,
    workerId: worker,
    charge: packet.charge,
    prosecution: arg("prosecution"),
    defense: arg("defense"),
    verdict: { ruling, reasoning: "r", cited_events: [], ...(ruling === "change_strategy" ? { instruction: "Mock the rates API." } : {}) },
    judgeModel: "mock",
    costUsd: 0,
    startedAt: at,
    finishedAt: at,
    mock: true,
    ...extra,
  };
}

const sj = (history: Trial[], cfg: RulesConfig = CFG, now = NOW, p = packet) => summaryJudgment(p, history, cfg, now);

// ---- 1. repeat offender: escalate, then halt ----

test("charged again within the window after change_strategy: escalate without a trial", () => {
  const s = sj([past("case-cs", 5, "change_strategy")]);
  assert.equal(s?.kind, "repeat_offender");
  assert.equal(s.verdict.ruling, "escalate");
  assert.deepEqual(s.priorCaseIds, ["case-cs"]);
  assert.deepEqual(s.verdict.cited_events, packet.charge.eventIds);
  assert.match(s.verdict.reasoning, /5 minutes after case-cs ordered a new strategy \("Mock the rates API\."\)/);
});

test("the repeat window is inclusive: exactly repeatWindowMin ago still counts", () => {
  assert.equal(sj([past("case-cs", 30, "change_strategy")])?.verdict.ruling, "escalate");
});

test("holdTrial chains the rule: change_strategy → escalate → halt, with no model calls", async () => {
  let calls = 0;
  const noModel = () => {
    calls++;
    throw new Error("a summary ruling must not call a model");
  };
  const client = { messages: { parse: noModel }, beta: { messages: { parse: noModel } } } as unknown as Anthropic;
  const cs = past("case-cs", 5, "change_strategy");

  const first = await holdTrial(packet, { mock: false, client, past: [cs], rules: CFG, now: NOW });
  assert.equal(first.summary, "repeat_offender");
  assert.equal(first.verdict.ruling, "escalate");
  assert.deepEqual(first.priorCaseIds, ["case-cs"]);
  assert.equal(first.costUsd, 0);
  assert.equal(first.costComplete, true);
  assert.equal(first.judgeModel, "none");
  assert.equal(first.prosecution.model, "none");
  assert.equal(first.defense.model, "none");
  assert.match(first.defense.argument, /not heard/);
  assert.equal(first.runSince, packet.runSince);

  // The case log records the escalation; the worker is charged again 30 seconds later.
  const logged = { ...first, finishedAt: iso(NOW + MIN) };
  const second = await holdTrial(packet, { mock: false, client, past: [cs, logged], rules: CFG, now: NOW + MIN + 30_000 });
  assert.equal(second.summary, "repeat_offender");
  assert.equal(second.verdict.ruling, "halt");
  assert.deepEqual(second.priorCaseIds, [first.id]);
  assert.match(second.verdict.reasoning, /under a minute/);
  assert.equal(calls, 0);
});

test("halt only follows a repeat-offender escalation, not an escalate from a full trial", () => {
  assert.equal(sj([past("case-esc", 5, "escalate")]), null);
});

// ---- 2. continue resets the chain ----

test("a continue ruling as the last trial: no summary", () => {
  assert.equal(sj([past("case-cs", 20, "change_strategy"), past("case-ok", 5, "continue")]), null);
});

// ---- 3. a quiet spell longer than the window resets it ----

test("a gap longer than repeatWindowMin: no summary", () => {
  assert.equal(sj([past("case-cs", 31, "change_strategy")]), null);
  assert.equal(sj([past("case-cs", 31, "change_strategy")], { ...CFG, repeatWindowMin: 45 })?.verdict.ruling, "escalate");
});

// ---- 4. other workers ----

test("another worker's trials are ignored", () => {
  assert.equal(sj([past("case-other", 5, "change_strategy", { workerId: "worker-99" })]), null);
  const expensive = [1, 2, 3, 4, 5, 6, 7].map((i) => past(`case-o${i}`, i * 5, "continue", { workerId: "worker-99", costUsd: 1 }));
  assert.equal(sj(expensive), null, "nor do they count toward this worker's court budget");
});

// ---- 5. same-run scoping ----

test("a past trial that finished before packet.runSince is ignored", () => {
  // The engine reuses worker IDs across runs: an old run's change_strategy must not count.
  const now = runStart + 10 * MIN;
  const before = { ...past("case-old", 0, "change_strategy"), finishedAt: iso(runStart - 1000) };
  const after = { ...past("case-new", 0, "change_strategy"), finishedAt: iso(runStart + 1000) };
  assert.equal(sj([before], CFG, now), null);
  assert.equal(sj([before, after], CFG, now)?.priorCaseIds[0], "case-new");
  const pricey = [1, 2, 3].map((i) => ({ ...past(`case-old${i}`, 0, "continue", { costUsd: 1 }), finishedAt: iso(runStart - i * MIN) }));
  assert.equal(sj(pricey, CFG, now), null, "an old run's court spend doesn't count either");
});

test("runSince comes from workerStartedAt when the engine sends it", () => {
  const started = "2026-10-24T21:00:00.000Z";
  const ep: EnginePacket = {
    charge: run.charge,
    events: run.events.slice(-6),
    testProgress: run.events.map((e) => ({ step: e.step, testsPassing: e.testsPassing, testsTotal: e.testsTotal })),
    spend: { costUsd: 0.3, budgetUsd: 1 },
    task: "t",
  };
  assert.equal(fromEnginePacket({ ...ep, workerStartedAt: started }).runSince, started);
  // Without it, the oldest event in the window stands in: later than the real start.
  assert.equal(fromEnginePacket(ep).runSince, run.events.at(-6)!.timestamp);
});

test("runSince falls back to the step-1 event, else the oldest event", () => {
  const step1 = run.events.find((e) => e.step === 1)!;
  assert.equal(packet.runSince, step1.timestamp);
  // Shuffled order: still the step-1 event, not whichever comes first in the array.
  const shuffled = [...run.events].reverse();
  assert.equal(buildPacket(run.charge, shuffled, { budgetUsd: 1 }).runSince, step1.timestamp);
  // No step 1 in the events: the lowest step.
  const later = run.events.filter((e) => e.step >= 5);
  assert.equal(buildPacket(run.charge, later, { budgetUsd: 1 }).runSince, run.events.find((e) => e.step === 5)!.timestamp);
});

test("an unknown run start takes no history: no summary", () => {
  const { runSince: _, ...noStart } = packet;
  assert.equal(sj([past("case-cs", 5, "change_strategy")], CFG, NOW, noStart), null);
  assert.equal(sj([past("case-cs", 5, "change_strategy")], CFG, NOW, { ...packet, runSince: "not a date" }), null);
});

// ---- 6. court budget ----

test("court spend at the floor: escalate (the floor beats a small fraction)", () => {
  const cap = Math.max(CFG.budgetFloorUsd, CFG.budgetFraction * packet.spend.usd);
  assert.equal(cap, CFG.budgetFloorUsd, "fixture spend is small enough that the floor applies");
  const s = sj([past("case-a", 50, "continue", { costUsd: 0.03 }), past("case-b", 40, "continue", { costUsd: 0.02 })]);
  assert.equal(s?.kind, "court_budget");
  assert.equal(s.verdict.ruling, "escalate");
  assert.deepEqual(s.priorCaseIds, ["case-a", "case-b"]);
  assert.match(s.verdict.reasoning, /already spent \$0\.0500/);
  assert.equal(sj([past("case-a", 50, "continue", { costUsd: 0.0499 })]), null, "just under the cap: full trial");
});

test("court spend at the fraction of worker spend: escalate (the fraction beats a small floor)", () => {
  const cfg = { ...CFG, budgetFraction: 0.5 };
  const cap = cfg.budgetFraction * packet.spend.usd;
  assert.ok(cap > cfg.budgetFloorUsd);
  assert.equal(sj([past("case-a", 10, "continue", { costUsd: cap })], cfg)?.kind, "court_budget");
  assert.equal(sj([past("case-a", 10, "continue", { costUsd: cap - 0.001 })], cfg), null);
});

test("summary trials don't count toward court spend", () => {
  const summaries = [1, 2, 3].map((i) => past(`case-s${i}`, i * 10, "escalate", { summary: "court_budget", costUsd: 1 }));
  assert.equal(sj(summaries), null);
});

test("6 full trials in the last hour: escalate; 5: full trial", () => {
  const six = [5, 15, 25, 35, 45, 55].map((m, i) => past(`case-${i}`, m, "continue"));
  const s = sj(six);
  assert.equal(s?.kind, "court_budget");
  assert.match(s.verdict.reasoning, /held 6 trials for this worker in the last hour/);
  assert.deepEqual(s.priorCaseIds, six.map((t) => t.id).reverse());
  assert.equal(sj(six.slice(0, 5)), null);
});

test("the hourly count is a rolling hour, and summary trials aren't counted", () => {
  const five = [5, 15, 25, 35, 45].map((m, i) => past(`case-${i}`, m, "continue"));
  assert.equal(sj([past("case-old", 61, "continue"), ...five]), null, "a trial 61 minutes ago has rolled off");
  const summaries = [10, 20, 30].map((m, i) => past(`case-s${i}`, m, "escalate", { summary: "court_budget" }));
  assert.equal(sj([...five, ...summaries]), null);
});

test("holdTrial over budget: court_budget summary, $0, judge none", async () => {
  const six = [5, 15, 25, 35, 45, 55].map((m, i) => past(`case-${i}`, m, "continue"));
  const t = await holdTrial(packet, { mock: true, past: six, rules: CFG, now: NOW });
  assert.equal(t.summary, "court_budget");
  assert.equal(t.verdict.ruling, "escalate");
  assert.equal(t.costUsd, 0);
  assert.equal(t.judgeModel, "none");
  assert.equal(t.priorCaseIds?.length, 6);
});

// ---- 7. switched off ----

test("cfg.enabled false: no summary, and holdTrial holds the full trial", async () => {
  const history = [past("case-cs", 5, "change_strategy")];
  const off = rulesConfig({ COURT_RULES: "off" });
  assert.equal(off.enabled, false);
  assert.equal(sj(history, off), null);
  const t = await holdTrial(packet, { mock: true, past: history, rules: off, now: NOW });
  assert.equal(t.summary, undefined);
  assert.equal(t.judgeModel, "mock");
});

test("without past trials, holdTrial never rules summarily", async () => {
  const t = await holdTrial(packet, { mock: true, rules: CFG, now: NOW });
  assert.equal(t.summary, undefined);
});

// ---- 8. env parsing ----

test("rulesConfig reads the env and falls back on bad or negative values", () => {
  const defaults = rulesConfig({});
  assert.deepEqual(defaults, { enabled: true, budgetFraction: 0.05, budgetFloorUsd: 0.05, maxTrialsPerHour: 6, repeatWindowMin: 30 });
  assert.deepEqual(
    rulesConfig({ COURT_BUDGET_FRACTION: "0.1", COURT_BUDGET_FLOOR_USD: "0", COURT_MAX_TRIALS_PER_HOUR: "3", COURT_REPEAT_WINDOW_MIN: "15" }),
    { enabled: true, budgetFraction: 0.1, budgetFloorUsd: 0, maxTrialsPerHour: 3, repeatWindowMin: 15 },
  );
  for (const bad of ["abc", "-1", "-0.5", "NaN", "Infinity"]) {
    assert.deepEqual(
      rulesConfig({ COURT_BUDGET_FRACTION: bad, COURT_BUDGET_FLOOR_USD: bad, COURT_MAX_TRIALS_PER_HOUR: bad, COURT_REPEAT_WINDOW_MIN: bad }),
      defaults,
      `"${bad}" should fall back to the defaults`,
    );
  }
  assert.equal(rulesConfig({ COURT_RULES: "on" }).enabled, true);
});

// ---- regressions (fixed in 0fb2fa6) ----

test("regression: blank or whitespace env values count as unset, not 0", () => {
  const defaults = rulesConfig({});
  for (const blank of ["", "   ", "\t"]) {
    const cfg = rulesConfig({ COURT_BUDGET_FRACTION: blank, COURT_BUDGET_FLOOR_USD: blank, COURT_MAX_TRIALS_PER_HOUR: blank, COURT_REPEAT_WINDOW_MIN: blank });
    assert.deepEqual(cfg, defaults, `${JSON.stringify(blank)} should fall back to the defaults`);
  }
  assert.equal(rulesConfig({ COURT_MAX_TRIALS_PER_HOUR: " 3 " }).maxTrialsPerHour, 3, "surrounding spaces are trimmed");
  // The bug's symptom: a blank COURT_MAX_TRIALS_PER_HOUR blocked every trial, even with no history.
  assert.equal(sj([], rulesConfig({ COURT_MAX_TRIALS_PER_HOUR: "" })), null);
});

test("regression: a $0 court cap doesn't block a trial when nothing has been spent", () => {
  const zero = { ...CFG, budgetFloorUsd: 0, budgetFraction: 0 };
  assert.equal(sj([], zero), null, "first charge, no history");
  assert.equal(sj([past("case-a", 10, "continue"), past("case-b", 5, "continue")], zero), null, "earlier trials that cost $0 (mock)");
  const s = sj([past("case-a", 10, "continue", { costUsd: 0.001 })], zero);
  assert.equal(s?.kind, "court_budget", "any real spend is over a $0 cap");
  const free = { ...packet, spend: { ...packet.spend, usd: 0 } };
  assert.equal(sj([], { ...CFG, budgetFloorUsd: 0 }, NOW, free), null, "floor 0 and a worker that has spent nothing");
});

test("regression: a gap that rounds to 1 minute reads '1 minute', not '1 minutes'", () => {
  for (const minutes of [1, 1.4]) {
    const s = sj([past("case-cs", minutes, "change_strategy")]);
    assert.match(s!.verdict.reasoning, /\b1 minute after case-cs/);
    assert.match(s!.prosecution, /\b1 minute after case-cs/);
    assert.doesNotMatch(`${s!.verdict.reasoning} ${s!.prosecution}`, /1 minutes/);
  }
  const esc = past("case-esc", 1, "escalate", { summary: "repeat_offender" });
  const halt = sj([esc]);
  assert.equal(halt?.verdict.ruling, "halt");
  assert.match(halt.verdict.reasoning, /a repeat offense 1 minute ago/);
  assert.match(sj([past("case-cs", 2, "change_strategy")])!.verdict.reasoning, /\b2 minutes after/);
  assert.match(sj([past("case-cs", 0.5, "change_strategy")])!.verdict.reasoning, /under a minute after/);
});
