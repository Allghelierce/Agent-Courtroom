import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

const { events, charge, budgetUsd } = loadFixture();
const packet = buildPacket(charge, events, { budgetUsd });

// Derived from the fixture so a realignment doesn't break the tests: the step where testsPassing peaked.
const peakStep = events.reduce((best, e) => (e.testsPassing > best.testsPassing ? e : best)).step;
const lastStep = events.at(-1)!.step;
const lastFailure = events.filter((e) => e.tool === "run_tests" && /fail|error/i.test(e.result ?? "")).at(-1)!.result;

test("window keeps the last 15 events, oldest first", () => {
  const ids = packet.events.map((e) => e.id);
  assert.deepEqual(ids, events.slice(-15).map((e) => e.id));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test("charged events outside the window are pulled in", () => {
  const p = buildPacket(charge, events, { budgetUsd, window: 2 });
  const ids = p.events.map((e) => e.id);
  for (const id of charge.eventIds) assert.ok(ids.includes(id), `missing charged event ${id}`);
  const recent = events.slice(-2).map((e) => e.id);
  assert.deepEqual(ids, [...new Set([...charge.eventIds, ...recent])].sort((a, b) => a - b));
  assert.ok(ids.length < events.length);
});

test("charged events are always in the packet", () => {
  const ids = new Set(packet.events.map((e) => e.id));
  for (const id of charge.eventIds) assert.ok(ids.has(id));
});

test("spend sums every event for the worker and reports fraction of budget", () => {
  const usd = events.reduce((s, e) => s + e.costUsd, 0);
  assert.ok(Math.abs(packet.spend.usd - usd) < 1e-4);
  assert.equal(packet.spend.budgetUsd, budgetUsd);
  assert.ok(Math.abs(packet.spend.fractionOfBudget - usd / budgetUsd) < 1e-4);
});

test("stepsSinceProgress counts from the last step that raised testsPassing", () => {
  assert.ok(lastStep - peakStep > 0, "fixture should end in a plateau");
  assert.equal(packet.stats.stepsSinceProgress, lastStep - peakStep);
});

test("repeatedCalls lists the charged call first", () => {
  const [top] = packet.stats.repeatedCalls;
  assert.deepEqual(top.eventIds, charge.eventIds);
  assert.equal(top.count, charge.eventIds.length);
  const charged = events.filter((e) => charge.eventIds.includes(e.id));
  assert.ok(charged.every((e) => e.tool === top.tool && e.result === charged[0].result), "charged events should be one repeated call");
});

test("repeatedCalls ranks charged overlap ahead of a more frequent call", () => {
  // Five identical extra read_file calls outnumber the charged calls.
  const last = events.at(-1)!;
  const extra = [1, 2, 3, 4, 5].map((i) => ({ ...last, id: 100 + i, step: last.step + i, tool: "read_file", args: { path: "src/rates.ts" }, result: "read 40 lines", error: null }));
  const p = buildPacket(charge, [...events, ...extra], { budgetUsd, window: 30 });
  const [top, next] = p.stats.repeatedCalls;
  assert.deepEqual(top.eventIds, charge.eventIds);
  assert.equal(next.tool, "read_file");
  assert.ok(next.count > top.count);
});

test("lastError falls back to the last failing test result when no event has an error", () => {
  assert.ok(events.every((e) => !e.error), "engine-style fixture has no tool errors");
  assert.equal(packet.stats.lastError, lastFailure);
  assert.equal(packet.stats.errorsInWindow, 0);
});

test("events from other workers are ignored", () => {
  const other = events.map((e) => ({ ...e, id: e.id + 1000, workerId: "worker-99", costUsd: 1 }));
  const p = buildPacket(charge, [...events, ...other], { budgetUsd });
  assert.ok(p.events.every((e) => e.workerId === charge.workerId));
  assert.equal(p.spend.usd, packet.spend.usd);
});
