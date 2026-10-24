import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket } from "../src/packet.ts";
import { holdTrial } from "../src/court.ts";
import { ev, loadFixture } from "./helpers.ts";

const { events, charge, budgetUsd } = loadFixture();

function subsetOfPacket(ids: number[], packetIds: Set<number>) {
  for (const id of ids) assert.ok(packetIds.has(id), `cited event ${id} is not in the packet`);
}

test("mock court rules change_strategy and tells the worker to mock the API", async () => {
  const packet = buildPacket(charge, events, { budgetUsd });
  const trial = await holdTrial(packet, { mock: true });
  assert.equal(trial.mock, true);
  assert.equal(trial.judgeModel, "mock");
  assert.equal(trial.costUsd, 0);
  assert.equal(trial.verdict.ruling, "change_strategy");
  assert.match(trial.verdict.instruction ?? "", /mock that API/i);
});

test("mock court only cites events that are in the packet", async () => {
  const packet = buildPacket(charge, events, { budgetUsd });
  const ids = new Set(packet.events.map((e) => e.id));
  const trial = await holdTrial(packet, { mock: true });
  subsetOfPacket(trial.verdict.cited_events, ids);
  subsetOfPacket(trial.prosecution.cited_events, ids);
  subsetOfPacket(trial.defense.cited_events, ids);
  assert.ok(trial.verdict.cited_events.length > 0);
});

test("mock court halts when spend is at least 90% of budget", async () => {
  const spent = events.reduce((s, e) => s + e.costUsd, 0);
  const packet = buildPacket(charge, events, { budgetUsd: spent / 0.9 });
  assert.ok(packet.spend.fractionOfBudget >= 0.9);
  const trial = await holdTrial(packet, { mock: true });
  assert.equal(trial.verdict.ruling, "halt");
  assert.equal(trial.verdict.instruction, undefined);
});

// Flailing is about the tool itself failing (e.error), so build it from synthetic tool errors.
function flailing(toolErrors: number) {
  const evts = Array.from({ length: 8 }, (_, i) =>
    i < toolErrors
      ? ev(i + 1, "edit_file", { path: "src/gateway.py", old_str: `attempt ${i}`, new_str: "fix" }, { error: "old_str not found" })
      : ev(i + 1, "run_tests", {}, { result: "FAILED test_charge: Connection refused" }),
  );
  return buildPacket({ workerId: "w", kind: "flailing", summary: "edit_file keeps failing", eventIds: evts.map((e) => e.id) }, evts, { budgetUsd: 1 });
}

test("mock court escalates flailing with 5 or more tool errors", async () => {
  const packet = flailing(5);
  assert.equal(packet.stats.errorsInWindow, 5);
  const trial = await holdTrial(packet, { mock: true });
  assert.equal(trial.verdict.ruling, "escalate");
});

test("mock court does not escalate flailing with only 4 tool errors", async () => {
  const packet = flailing(4);
  assert.equal(packet.stats.errorsInWindow, 4);
  const trial = await holdTrial(packet, { mock: true });
  assert.notEqual(trial.verdict.ruling, "escalate");
});

test("onTrial receives the finished trial", async () => {
  const packet = buildPacket(charge, events, { budgetUsd });
  let seen: string | undefined;
  const trial = await holdTrial(packet, { mock: true, onTrial: (t) => void (seen = t.id) });
  assert.equal(seen, trial.id);
});

// Premature stall: a stalling charge whose window has at most one test run and no tool errors.
function stall(tools: string[], toolError = false) {
  const evts = tools.map((tool, i) =>
    ev(i + 1, tool, tool === "run_tests" ? {} : { path: "src/dates.ts" }, {
      testsPassing: 2,
      testsTotal: 12,
      result: tool === "run_tests" ? "2/12 passing; failing: test_due_date_tz" : "read 30 lines",
      ...(toolError && i === 1 ? { error: "old_str not found" } : {}),
    }),
  );
  return buildPacket({ workerId: "w", kind: "stalling", summary: "stuck at 2/12", eventIds: evts.map((e) => e.id) }, evts, { budgetUsd: 1 });
}

test("mock court rules continue on a premature stall (one test run, no tool errors)", async () => {
  const trial = await holdTrial(stall(["run_tests", "read_file", "read_file", "edit_file", "read_file", "edit_file"]), { mock: true });
  assert.equal(trial.verdict.ruling, "continue");
});

test("a stall with two or more test runs is not premature", async () => {
  const trial = await holdTrial(stall(["run_tests", "read_file", "edit_file", "run_tests", "edit_file", "read_file"]), { mock: true });
  assert.notEqual(trial.verdict.ruling, "continue");
});

test("a stall with a tool error is not premature", async () => {
  const trial = await holdTrial(stall(["run_tests", "edit_file", "read_file", "edit_file", "read_file", "edit_file"], true), { mock: true });
  assert.notEqual(trial.verdict.ruling, "continue");
});
