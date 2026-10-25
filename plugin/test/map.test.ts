import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapToolCall, normalize } from "../src/map.ts";
import { parseTestRun } from "../src/progress.ts";
import { TranscriptMeter } from "../src/cost.ts";

const UNITTEST_FAIL = `....E.....
======================================================================
ERROR: test_checkout_charges_the_gateway (test_checkout.TestCheckout.test_checkout_charges_the_gateway)
----------------------------------------------------------------------
Traceback (most recent call last):
urllib.error.URLError: <urlopen error [Errno 61] Connection refused>

----------------------------------------------------------------------
Ran 11 tests in 0.006s

FAILED (errors=1)`;

test("parses unittest, pytest, jest, vitest, node:test and cargo summaries", () => {
  assert.deepEqual(parseTestRun(UNITTEST_FAIL), { passing: 10, total: 11, failing: ["test_checkout_charges_the_gateway"] });
  assert.deepEqual(parseTestRun("Ran 5 tests in 0.001s\n\nOK"), { passing: 5, total: 5, failing: [] });
  assert.deepEqual(parseTestRun("FAILED tests/test_a.py::test_x - assert 1 == 2\n===== 1 failed, 9 passed in 0.12s ====="), { passing: 9, total: 10, failing: ["test_x"] });
  assert.equal(parseTestRun("Tests:       1 failed, 10 passed, 11 total")?.passing, 10);
  assert.equal(parseTestRun(" Tests  2 failed | 9 passed (11)")?.total, 11);
  assert.deepEqual(parseTestRun("ℹ tests 65\nℹ pass 64\nℹ fail 1"), { passing: 64, total: 65, failing: [] });
  assert.equal(parseTestRun("test result: FAILED. 5 passed; 1 failed; 0 ignored")?.total, 6);
  assert.equal(parseTestRun("hello world"), null);
});

test("a failing test run is run_tests with the failure in result, not a tool error", () => {
  const m = mapToolCall({ tool_name: "Bash", tool_input: { command: "python -m unittest" }, error: `Exit code 1\n${UNITTEST_FAIL}` });
  assert.equal(m.tool, "run_tests");
  assert.equal(m.error, undefined);
  assert.equal(m.result, "10/11 passing; failing: test_checkout_charges_the_gateway — urllib.error.URLError: <urlopen error [Errno 61] Connection refused>");
  assert.deepEqual(m.tests, { passing: 10, total: 11, failing: ["test_checkout_charges_the_gateway"] });
});

test("the same test run with a different duration maps to the same result", () => {
  const a = mapToolCall({ tool_name: "Bash", tool_input: { command: "pytest" }, tool_response: { stdout: "===== 1 failed, 9 passed in 0.12s =====" } });
  const b = mapToolCall({ tool_name: "Bash", tool_input: { command: "pytest" }, tool_response: { stdout: "===== 1 failed, 9 passed in 3.40s =====" } });
  assert.deepEqual(a, b);
});

test("Read, Edit and Write use the engine's tool names with paths relative to the project", () => {
  const cwd = "/work/shop";
  assert.deepEqual(mapToolCall({ tool_name: "Read", cwd, tool_input: { file_path: "/work/shop/payments.py" }, tool_response: { file: { numLines: 19 } } }), {
    tool: "read_file", args: { path: "payments.py" }, result: "read 19 lines",
  });
  const edit = mapToolCall({ tool_name: "Edit", cwd, tool_input: { file_path: "/work/shop/payments.py", old_string: "timeout=3", new_string: "timeout=10" } });
  assert.deepEqual(edit, { tool: "edit_file", args: { path: "payments.py", old_str: "timeout=3", new_str: "timeout=10" }, result: "edited payments.py" });
  assert.equal(mapToolCall({ tool_name: "Write", cwd, tool_input: { file_path: "/work/shop/a.py", content: "x" } }).result, "wrote a.py");
});

test("a real tool failure is an error", () => {
  const m = mapToolCall({ tool_name: "Edit", tool_input: { file_path: "a.py", old_string: "x", new_string: "y" }, error: "String to replace not found in file." });
  assert.equal(m.error, "String to replace not found in file.");
  assert.equal(mapToolCall({ tool_name: "Bash", tool_input: { command: "curl x" }, is_interrupt: true, error: "" }).error, "interrupted by the user");
});

test("normalize strips timings, timestamps and addresses", () => {
  assert.equal(normalize("done in 12.5s at 2026-10-24T22:03:10.372Z obj 0x7f3a2b1c9d"), "done in <t> at <time> obj 0x…");
});

test("the transcript meter prices each message once, only once it's new", () => {
  const dir = mkdtempSync(join(tmpdir(), "courtroom-cost-"));
  const path = join(dir, "t.jsonl");
  const prices = { models: { "claude-opus-5-5": [4, 20, 5, 8, 0.2] } };
  const msg = (id: string) => JSON.stringify({ type: "assistant", message: { id, model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10000 } } });
  writeFileSync(path, `${JSON.stringify({ type: "user" })}\n${msg("m1")}\n${msg("m1")}\n`);
  const meter = new TranscriptMeter(prices);
  const first = meter.read(path);
  assert.equal(first.tokens, 11100);
  assert.ok(Math.abs(first.costUsd - (1000 * 4 + 100 * 20 + 10000 * 0.2) / 1e6) < 1e-12);
  assert.equal(meter.read(path).tokens, 0);
  appendFileSync(path, `${msg("m2")}\n`);
  assert.equal(meter.read(path).tokens, 11100);
  assert.equal(new TranscriptMeter({ models: {} }).read(path).priced, false);
});
