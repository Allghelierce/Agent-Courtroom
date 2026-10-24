import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket } from "../src/packet.ts";
import { holdTrial } from "../src/court.ts";
import { loadFixture } from "./helpers.ts";

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

test("mock court escalates flailing with 5 or more errors", async () => {
  const packet = buildPacket({ ...charge, kind: "flailing" }, events, { budgetUsd });
  assert.ok(packet.stats.errorsInWindow >= 5);
  const trial = await holdTrial(packet, { mock: true });
  assert.equal(trial.verdict.ruling, "escalate");
});

test("onTrial receives the finished trial", async () => {
  const packet = buildPacket(charge, events, { budgetUsd });
  let seen: string | undefined;
  const trial = await holdTrial(packet, { mock: true, onTrial: (t) => void (seen = t.id) });
  assert.equal(seen, trial.id);
});
