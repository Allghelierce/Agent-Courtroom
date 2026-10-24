import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPacket } from "../src/packet.ts";
import { findPrecedents, renderPrecedents, tokens } from "../src/precedent.ts";
import type { ChargeKind, Trial } from "../src/types.ts";
import type { Fixture } from "./helpers.ts";
import { loadFixture } from "./helpers.ts";

const sample: Trial = JSON.parse(readFileSync(new URL("../examples/sample-trial.json", import.meta.url), "utf8"));
const { events, charge, budgetUsd } = loadFixture();
const packet = buildPacket(charge, events, { budgetUsd }); // worker-03, looping, ECONNREFUSED

const NOW = Date.parse("2026-10-24T23:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function trial(id: string, over: { workerId?: string; kind?: ChargeKind; summary?: string; argument?: string; finishedAt?: string } = {}): Trial {
  const workerId = over.workerId ?? "worker-09";
  return {
    ...sample,
    id,
    workerId,
    charge: { ...sample.charge, workerId, kind: over.kind ?? sample.charge.kind, summary: over.summary ?? sample.charge.summary },
    prosecution: { ...sample.prosecution, argument: over.argument ?? sample.prosecution.argument },
    finishedAt: over.finishedAt ?? minutesAgo(60),
  };
}

function loadRun(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

test("no past trials gives no precedents and an empty block", () => {
  assert.deepEqual(findPrecedents(packet, [], 3, { now: NOW }), []);
  assert.equal(renderPrecedents([]), "");
});

test("a matching charge kind outranks a closer error match", () => {
  const sameKind = trial("case-kind", { summary: "Ran the same test command 3 times", argument: "Nothing in common here." });
  const sameError = trial("case-error", { kind: "stalling" });
  const ids = findPrecedents(packet, [sameError, sameKind], 3, { now: NOW }).map((t) => t.id);
  assert.deepEqual(ids, ["case-kind", "case-error"]);
});

test("within the same kind, more overlapping error text ranks higher", () => {
  const close = trial("case-close"); // quotes ECONNREFUSED api.rates.example
  const far = trial("case-far", { summary: "Ran the same test command 3 times", argument: "Pagination returned 50 items." });
  const ids = findPrecedents(packet, [far, close], 3, { now: NOW }).map((t) => t.id);
  assert.deepEqual(ids, ["case-close", "case-far"]);
});

test("the same worker's trials from the last 2 minutes are skipped", () => {
  const fresh = trial("case-fresh", { workerId: packet.workerId, finishedAt: minutesAgo(1) });
  const older = trial("case-older", { workerId: packet.workerId, finishedAt: minutesAgo(5) });
  const otherFresh = trial("case-other", { workerId: "worker-07", finishedAt: minutesAgo(1) });
  const ids = findPrecedents(packet, [fresh, older, otherFresh], 3, { now: NOW }).map((t) => t.id);
  assert.ok(!ids.includes("case-fresh"));
  assert.ok(ids.includes("case-older"));
  assert.ok(ids.includes("case-other"));
});

test("the sample trial is its own worker's fresh case, so it is skipped right after it ends", () => {
  const justAfter = Date.parse(sample.finishedAt) + 30_000;
  assert.deepEqual(findPrecedents(packet, [sample], 3, { now: justAfter }), []);
  assert.deepEqual(findPrecedents(packet, [sample], 3, { now: NOW }).map((t) => t.id), [sample.id]);
});

test("returns at most k, and ties go to the most recent trial", () => {
  const past = [1, 2, 3, 4, 5].map((m) => trial(`case-${m}`, { finishedAt: minutesAgo(m * 10) }));
  const ids = findPrecedents(packet, past, 2, { now: NOW }).map((t) => t.id);
  assert.deepEqual(ids, ["case-1", "case-2"]);
  assert.equal(findPrecedents(packet, past, undefined, { now: NOW }).length, 3);
});

test("unrelated trials (other kind, no shared words) are not precedents", () => {
  const unrelated = trial("case-x", { kind: "overspending", summary: "Budget nearly gone", argument: "Reindex timed out." });
  assert.deepEqual(findPrecedents(packet, [unrelated], 3, { now: NOW }), []);
});

test("a stalling case ranks the stalling precedent above a looping one", () => {
  const stalling = loadRun("stalling-run.json");
  const p = buildPacket(stalling.charge, stalling.events, { budgetUsd: stalling.budgetUsd });
  const looping = trial("case-loop");
  const stalled = trial("case-stall", { kind: "stalling", summary: "Passing tests stuck at 6/10", argument: "test_due_date_tz keeps failing." });
  const ids = findPrecedents(p, [looping, stalled], 3, { now: NOW }).map((t) => t.id);
  assert.equal(ids[0], "case-stall");
});

test("render lists each case with kind, worker, ruling, and instruction", () => {
  const block = renderPrecedents([trial("case-ab12", { workerId: "rates-service" })]);
  const [head, line] = block.split("\n");
  assert.equal(head, "PRECEDENTS:");
  assert.match(line, /^- case-ab12 \(looping, rates-service\): CHANGE_STRATEGY — "Stop editing the code for the failing test\./);
});

test("render falls back to the first sentence of the reasoning", () => {
  const t = trial("case-r");
  t.verdict = { ruling: "halt", reasoning: "Budget is spent. Nothing else will pass.", cited_events: [1] };
  assert.equal(renderPrecedents([t]), 'PRECEDENTS:\n- case-r (looping, worker-09): HALT — "Budget is spent."');
});

test("tokens drops short words, numbers, and filler", () => {
  assert.deepEqual([...tokens("Made the same edit to src/rates.ts 3 times: ECONNREFUSED 443")].sort(), ["econnrefused", "edit", "made", "rates", "src"]);
});
