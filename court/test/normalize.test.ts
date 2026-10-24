import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVerdict } from "../src/court.ts";

const valid = new Set([12, 14, 16]);

test("drops cited ids that are not in the packet", () => {
  const v = normalizeVerdict({ ruling: "halt", instruction: "", reasoning: "r", cited_events: [12, 99, 16, -1] }, valid);
  assert.deepEqual(v.cited_events, [12, 16]);
});

test("change_strategy with an empty instruction becomes escalate", () => {
  for (const instruction of ["", "   "]) {
    const v = normalizeVerdict({ ruling: "change_strategy", instruction, reasoning: "r", cited_events: [12] }, valid);
    assert.equal(v.ruling, "escalate");
    assert.equal(v.instruction, undefined);
    assert.deepEqual(v.cited_events, [12]);
  }
});

test("change_strategy keeps a trimmed instruction", () => {
  const v = normalizeVerdict({ ruling: "change_strategy", instruction: "  mock the API  ", reasoning: "r", cited_events: [] }, valid);
  assert.equal(v.ruling, "change_strategy");
  assert.equal(v.instruction, "mock the API");
});

test("other rulings drop the instruction field", () => {
  const v = normalizeVerdict({ ruling: "continue", instruction: "ignored", reasoning: "r", cited_events: [] }, valid);
  assert.equal(v.ruling, "continue");
  assert.ok(!("instruction" in v));
});
