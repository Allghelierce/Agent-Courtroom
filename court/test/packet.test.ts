import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

const { events, charge, budgetUsd } = loadFixture();
const packet = buildPacket(charge, events, { budgetUsd });

test("window keeps the last 15 events, oldest first", () => {
  const ids = packet.events.map((e) => e.id);
  assert.deepEqual(ids, events.slice(-15).map((e) => e.id));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test("charged events outside the window are pulled in", () => {
  const p = buildPacket(charge, events, { budgetUsd, window: 2 });
  const ids = p.events.map((e) => e.id);
  for (const id of charge.eventIds) assert.ok(ids.includes(id), `missing charged event ${id}`);
  assert.deepEqual(ids, [12, 14, 15, 16]);
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
  // testsPassing peaks at 11 on step 11; the run ends on step 16.
  assert.equal(packet.stats.stepsSinceProgress, 5);
});

test("repeatedCalls lists the charged edit first", () => {
  const [top] = packet.stats.repeatedCalls;
  assert.equal(top.tool, "edit_file");
  assert.match(top.args, /src\/rates\.ts/);
  assert.deepEqual(top.eventIds, charge.eventIds);
  assert.equal(top.count, 3);
});

test("repeatedCalls ranks charged overlap ahead of a more frequent call", () => {
  // Five identical extra run_tests calls outnumber the 3 charged edits.
  const last = events.at(-1)!;
  const extra = [1, 2, 3, 4, 5].map((i) => ({ ...last, id: 100 + i, step: last.step + i, tool: "run_tests", args: {}, error: null }));
  const p = buildPacket(charge, [...events, ...extra], { budgetUsd, window: 20 });
  const [top, next] = p.stats.repeatedCalls;
  assert.deepEqual(top.eventIds, charge.eventIds);
  assert.equal(next.tool, "run_tests");
  assert.ok(next.count > top.count);
});

test("lastError is the most recent error in the window", () => {
  assert.equal(packet.stats.lastError, "1 failing; test_fetch_rates: ECONNREFUSED api.rates.example:443");
  assert.equal(packet.stats.errorsInWindow, 5);
});

test("events from other workers are ignored", () => {
  const other = events.map((e) => ({ ...e, id: e.id + 1000, workerId: "worker-99", costUsd: 1 }));
  const p = buildPacket(charge, [...events, ...other], { budgetUsd });
  assert.ok(p.events.every((e) => e.workerId === charge.workerId));
  assert.equal(p.spend.usd, packet.spend.usd);
});
