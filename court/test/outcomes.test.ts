import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket, callKey } from "../src/packet.ts";
import type { Charge, Event } from "../src/types.ts";

// Engine-style events: failures live in `result`, run_tests args are {}.
function ev(id: number, tool: string, args: Record<string, unknown>, extra: Partial<Event> = {}): Event {
  return {
    id,
    workerId: "w",
    step: id,
    tool,
    args,
    tokens: 100,
    costUsd: 0.01,
    testsPassing: 5,
    testsTotal: 10,
    timestamp: `2026-10-24T22:00:${String(id).padStart(2, "0")}Z`,
    ...extra,
  };
}

const charge = (eventIds: number[]): Charge => ({ workerId: "w", kind: "looping", summary: "s", eventIds });
const packet = (events: Event[]) => buildPacket(charge(events.map((e) => e.id)), events, { budgetUsd: 1 });

test("three run_tests {} with different results are not a repeat", () => {
  const p = packet([
    ev(1, "run_tests", {}, { result: "5 passed, 5 failed" }),
    ev(2, "run_tests", {}, { result: "6 passed, 4 failed" }),
    ev(3, "run_tests", {}, { result: "7 passed, 3 failed" }),
  ]);
  assert.deepEqual(p.stats.repeatedCalls, []);
});

test("run_tests {} with the same result is a repeat", () => {
  const p = packet([
    ev(1, "run_tests", {}, { result: "FAILED test_fetch: Connection refused" }),
    ev(2, "edit_file", { path: "a.py", old_str: "x", new_str: "y" }),
    ev(3, "run_tests", {}, { result: "FAILED test_fetch: Connection refused" }),
    ev(4, "run_tests", {}, { result: "FAILED test_fetch: Connection refused" }),
  ]);
  assert.equal(p.stats.repeatedCalls.length, 1);
  assert.deepEqual(p.stats.repeatedCalls[0].eventIds, [1, 3, 4]);
  assert.equal(p.stats.repeatedCalls[0].args, "{}");
});

test("same edit with old_str/new_str and the same result is a repeat", () => {
  const args = { path: "src/gateway.py", old_str: "timeout=5", new_str: "timeout=30" };
  const p = packet([ev(1, "edit_file", args, { result: "ok" }), ev(2, "edit_file", { ...args }, { result: "ok" })]);
  assert.deepEqual(p.stats.repeatedCalls[0]?.eventIds, [1, 2]);
});

test("same args and result but a different error is not a repeat", () => {
  const p = packet([
    ev(1, "run_tests", {}, { result: "1 failed", error: "ECONNREFUSED" }),
    ev(2, "run_tests", {}, { result: "1 failed", error: "ETIMEDOUT" }),
  ]);
  assert.deepEqual(p.stats.repeatedCalls, []);
});

test("callKey treats a missing result and error like empty ones, and ignores arg key order", () => {
  const a = ev(1, "edit_file", { path: "p", old_str: "a", new_str: "b" });
  const b = ev(2, "edit_file", { new_str: "b", old_str: "a", path: "p" }, { result: undefined, error: null });
  assert.equal(callKey(a), callKey(b));
  assert.notEqual(callKey(a), callKey({ ...a, result: "ok" }));
});

test("lastError falls back to the last failing result when no event has an error", () => {
  const p = packet([
    ev(1, "run_tests", {}, { result: "FAILED test_a: AssertionError" }),
    ev(2, "edit_file", { path: "a.py", old_str: "x", new_str: "y" }, { result: "edited a.py" }),
    ev(3, "run_tests", {}, { result: "FAILED test_fetch: Connection refused" }),
    ev(4, "read_file", { path: "a.py" }, { result: "def a(): ..." }),
  ]);
  assert.equal(p.stats.lastError, "FAILED test_fetch: Connection refused");
  assert.equal(p.stats.errorsInWindow, 0);
});

test("lastError ignores results that report no failure", () => {
  const p = packet([ev(1, "run_tests", {}, { result: "10 passed" }), ev(2, "read_file", { path: "a.py" }, { result: "x = 1" })]);
  assert.equal(p.stats.lastError, null);
});

test("an event error still wins over a later failing result", () => {
  const p = packet([
    ev(1, "run_tests", {}, { error: "ECONNREFUSED api.example:443" }),
    ev(2, "run_tests", {}, { result: "1 failed" }),
  ]);
  assert.equal(p.stats.lastError, "ECONNREFUSED api.example:443");
});
