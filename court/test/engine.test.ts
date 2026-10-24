import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fromEnginePacket } from "../src/packet.ts";
import { holdTrial } from "../src/court.ts";
import { renderPacket } from "../src/prompts.ts";
import type { EnginePacket, Ruling } from "../src/types.ts";
import { loadFixture } from "./helpers.ts";

const fx = loadFixture();

// The engine sends only a recent window of events, plus full spend and test history.
function enginePacket(overrides: Partial<EnginePacket> = {}): EnginePacket {
  const events = fx.events.slice(-6).map((e, i) => (i === 0 ? { ...e, result: "patched fetchRates with 3 retries" } : e));
  return {
    charge: { ...fx.charge, id: 7 },
    events,
    testProgress: fx.events.map((e) => ({ step: e.step, testsPassing: e.testsPassing, testsTotal: e.testsTotal })),
    spend: { costUsd: 0.75, budgetUsd: 1.0 },
    task: "Make the rates-service test suite pass.",
    ...overrides,
  };
}

test("spend comes from packet.spend.costUsd, not the event sum", () => {
  const ep = enginePacket();
  const eventSum = ep.events.reduce((s, e) => s + e.costUsd, 0);
  const p = fromEnginePacket(ep);
  assert.notEqual(p.spend.usd, eventSum);
  assert.equal(p.spend.usd, 0.75);
  assert.equal(p.spend.budgetUsd, 1.0);
  assert.equal(p.spend.fractionOfBudget, 0.75);
});

test("progress comes from testProgress, including steps outside the event window", () => {
  const ep = enginePacket();
  const p = fromEnginePacket(ep);
  assert.deepEqual(p.progress, ep.testProgress);
  // The window is all at 11 passing; only the full history shows the rise to 11 at step 11.
  assert.equal(p.stats.stepsSinceProgress, 5);
  assert.equal(p.stats.totalSteps, 16);
});

test("testProgress past the last event extends stepsSinceProgress", () => {
  const ep = enginePacket();
  const p = fromEnginePacket({ ...ep, testProgress: [...ep.testProgress, { step: 20, testsPassing: 11, testsTotal: 12 }] });
  assert.equal(p.stats.stepsSinceProgress, 9);
});

test("renderPacket shows the task and event results", () => {
  const ep = enginePacket();
  const text = renderPacket(fromEnginePacket(ep));
  assert.match(text, /^WORKER'S TASK: Make the rates-service test suite pass\./);
  assert.match(text, new RegExp(`#${ep.events[0].id} step .* -> patched fetchRates with 3 retries \\|`));
  assert.match(text, /SPEND: \$0\.7500 of \$1\.00 budget \(75%\)/);
});

test("renderPacket truncates a long task", () => {
  const text = renderPacket(fromEnginePacket(enginePacket({ task: "x".repeat(1000) })));
  const line = text.split("\n")[0];
  assert.ok(line.length < 330, `task line is ${line.length} chars`);
  assert.ok(line.endsWith("…"));
});

test("charge.id survives into the packet and the trial", async () => {
  const p = fromEnginePacket(enginePacket());
  assert.equal(p.charge.id, 7);
  const trial = await holdTrial(p, { mock: true });
  assert.equal(trial.charge.id, 7);
});

test("every event the engine sends is kept, even past the default window of 15", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...fx.events[0], id: i + 1, step: i + 1 }));
  const p = fromEnginePacket(enginePacket({ events: many, charge: { ...fx.charge, eventIds: [1] } }));
  assert.equal(p.events.length, 20);
});

// fa's engine-shaped fixture: either an EnginePacket itself or { packet, verdict }.
const checkout = new URL("../fixtures/engine-packet-checkout.json", import.meta.url);
test("engine-packet-checkout.json: mock court gives the expected ruling", { skip: existsSync(checkout) ? false : "fixture not landed yet" }, async () => {
  const raw = JSON.parse(readFileSync(checkout, "utf8"));
  const ep: EnginePacket = raw.packet ?? raw;
  const p = fromEnginePacket(ep);
  assert.equal(p.spend.usd, ep.spend.costUsd);
  assert.deepEqual(p.progress, ep.testProgress);
  assert.equal(p.charge.id, ep.charge.id);
  const trial = await holdTrial(p, { mock: true });
  const ids = new Set(p.events.map((e) => e.id));
  for (const id of trial.verdict.cited_events) assert.ok(ids.has(id), `cited event ${id} is not in the packet`);
  const note: string | undefined = raw.verdict?.expected ?? raw.verdict?.ruling;
  if (note) {
    const ok = note.split(":")[0].split(/\s+or\s+/).map((r) => r.trim()) as Ruling[];
    assert.ok(ok.includes(trial.verdict.ruling), `got ${trial.verdict.ruling}, expected ${ok.join(" or ")}`);
  }
});
