import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Event } from "../../court/src/index.ts";
import { check, DEFAULT_CONFIG, pyDumps, SESSION_CONFIG } from "../src/monitors.ts";

const root = new URL("../../", import.meta.url);
const pyScript = new URL("py_monitors.py", import.meta.url).pathname;

// Every recorded or scripted run we have: court fixtures and the engine's samples (one run per worker).
function runs(): { name: string; budgetUsd: number; events: Event[] }[] {
  const out: { name: string; budgetUsd: number; events: Event[] }[] = [];
  const fixtures = new URL("court/fixtures/", root);
  for (const f of readdirSync(fixtures)) {
    const raw = readFileSync(new URL(f, fixtures), "utf8");
    if (f.endsWith("-run.json")) {
      const fx = JSON.parse(raw);
      out.push({ name: f, budgetUsd: fx.budgetUsd, events: fx.events });
    } else if (f.startsWith("engine-packet-") && f.endsWith(".json")) {
      const fx = JSON.parse(raw);
      const p = fx.packet ?? fx;
      out.push({ name: f, budgetUsd: p.spend.budgetUsd, events: p.events });
    } else if (f.endsWith(".jsonl")) {
      out.push(...streamRuns(f, raw));
    }
  }
  const samples = new URL("shared/samples/", root);
  for (const f of readdirSync(samples).filter((f) => f.endsWith(".jsonl"))) out.push(...streamRuns(f, readFileSync(new URL(f, samples), "utf8")));
  return out;
}

function streamRuns(name: string, text: string) {
  const byWorker = new Map<string, { budgetUsd: number; events: Event[] }>();
  for (const line of text.split("\n").filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.type === "worker") byWorker.set(m.data.workerId, byWorker.get(m.data.workerId) ?? { budgetUsd: m.data.budgetUsd, events: [] });
    if (m.type === "event") byWorker.get(m.data.workerId)?.events.push(m.data);
  }
  return [...byWorker].map(([w, r]) => ({ name: `${name}:${w}`, ...r }));
}

const python = (() => {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 10)"]);
    return true;
  } catch {
    return false;
  }
})();

for (const run of runs()) {
  test(`monitors match the engine on ${run.name}`, { skip: python ? false : "python3 >= 3.10 not available" }, () => {
    const expected = JSON.parse(execFileSync("python3", ["-I", pyScript], { input: JSON.stringify(run) }).toString());
    const actual = run.events.map((_, i) => check(run.events.slice(0, i + 1), run.budgetUsd, DEFAULT_CONFIG));
    assert.deepEqual(actual, expected);
  });
}

test("pyDumps matches Python's json.dumps(sort_keys=True)", () => {
  assert.equal(pyDumps({ url: "https://x", a: [1, 2.5, true, null] }), '{"a": [1, 2.5, true, null], "url": "https://x"}');
  assert.equal(pyDumps("café —"), '"caf\\u00e9 \\u2014"');
  assert.equal(pyDumps({}), "{}");
});

test("progressRequired keeps stalling and per-test spend quiet when no tests ever ran", () => {
  const ev = (i: number): Event => ({
    id: i, workerId: "w", step: i, tool: "read_file", args: { path: `f${i}` }, tokens: 0, costUsd: 0.2,
    testsPassing: 0, testsTotal: 0, result: `read ${i} lines`, timestamp: "2026-10-24T00:00:00Z",
  });
  const events = Array.from({ length: 9 }, (_, i) => ev(i + 1));
  assert.equal(check(events, 100, DEFAULT_CONFIG)?.kind, "stalling");
  assert.equal(check(events, 100, { ...DEFAULT_CONFIG, progressRequired: true }), null);
  // The budget rule still applies: 9 x $0.20 = $1.80 of $2.00.
  assert.equal(check(events, 2, { ...DEFAULT_CONFIG, progressRequired: true })?.kind, "overspending");
});

// Claude Code sessions: false alarms found by replaying real transcripts (scripts/replay.ts), and the loops that
// must still be caught. Each false alarm also shows the engine rule, which stays as it was.
let nextId = 0;
const step = (tool: string, args: Record<string, unknown>, result: string, tests: [number, number], error?: string): Event => ({
  id: ++nextId, workerId: "w", step: nextId, tool, args, tokens: 0, costUsd: 0, testsPassing: tests[0], testsTotal: tests[1],
  result, ...(error ? { error } : {}), timestamp: "2026-10-24T00:00:00Z",
});
const read = (path: string, tests: [number, number]) => step("read_file", { path }, "read 40 lines", tests);
const edit = (n: number, tests: [number, number]) => step("edit_file", { path: "cart.py", old_str: `a${n}`, new_str: `b${n}` }, "edited cart.py", tests);
const suite = (command: string, [pass, total]: [number, number], why = "ConnectionRefusedError: [Errno 61] Connection refused") =>
  step("run_tests", { command }, `${pass}/${total} passing; failing: test_checkout_charges_the_gateway — ${why}`, [pass, total]);
const TESTS = "python3 -m unittest discover -s tests";

test("sessions: stalling stays quiet once every test passes", () => {
  const events = [step("run_tests", { command: TESTS }, "11/11 passing", [11, 11]), ...Array.from({ length: 8 }, (_, i) => read(`f${i}.py`, [11, 11]))];
  assert.equal(check(events, 100, DEFAULT_CONFIG)?.kind, "stalling");
  assert.equal(check(events, 100, SESSION_CONFIG), null);
});

test("sessions: stalling stays quiet on a test count from one old run", () => {
  const events = [suite(TESTS, [10, 11]), ...Array.from({ length: 8 }, (_, i) => edit(i, [10, 11]))];
  assert.equal(check(events, 100, DEFAULT_CONFIG)?.kind, "stalling");
  assert.equal(check(events, 100, SESSION_CONFIG), null);
});

test("sessions: stalling still fires when Claude keeps rerunning a failing suite with no progress", () => {
  // Different failure text each run, so this is stalling, not looping.
  const events = Array.from({ length: 8 }, (_, i) => (i % 2 ? suite(TESTS, [10, 11], `AssertionError: attempt ${i}`) : edit(i, [10, 11])));
  assert.equal(check(events, 100, SESSION_CONFIG)?.kind, "stalling");
});

test("sessions: rerunning a check that passes between edits is not looping", () => {
  const ok = () => step("bash", { command: "npx tsc --noEmit" }, "ok, no output", [0, 0]);
  const events = [edit(1, [0, 0]), ok(), edit(2, [0, 0]), ok(), edit(3, [0, 0]), ok()];
  assert.equal(check(events, 100, DEFAULT_CONFIG)?.kind, "looping");
  assert.equal(check(events, 100, SESSION_CONFIG), null);
});

test("sessions: re-reading a screenshot after regenerating it is not looping", () => {
  const shot = () => step("bash", { command: "node shot.mjs" }, "saved shot.png", [0, 0]);
  const look = () => step("read_file", { path: "shot.png" }, "read 1 lines", [0, 0]);
  const events = [shot(), look(), edit(1, [0, 0]), shot(), look(), edit(2, [0, 0]), shot(), look()];
  assert.equal(check(events, 100, DEFAULT_CONFIG)?.kind, "looping");
  assert.equal(check(events, 100, SESSION_CONFIG), null);
});

test("sessions: the same failing test run three times is still looping", () => {
  const events = [suite(TESTS, [10, 11]), suite(TESTS, [10, 11]), suite(TESTS, [10, 11])];
  assert.equal(check(events, 100, SESSION_CONFIG)?.kind, "looping");
});

test("sessions: slight variations of the same failing command are looping", () => {
  const events = [suite(TESTS, [10, 11]), suite(`${TESTS} -v`, [10, 11]), suite(`cd /tmp/court-demo && ${TESTS} 2>&1 | tail -20`, [10, 11])];
  assert.equal(check(events, 100, DEFAULT_CONFIG), null);
  const charge = check(events, 100, SESSION_CONFIG);
  assert.equal(charge?.kind, "looping");
  assert.deepEqual(charge?.eventIds, events.map((e) => e.id));
});

test("sessions: switching to a different test suite is not stalling", () => {
  // 73/73 in one suite, then 19/20 in another: the count fell, but nothing stalled.
  const other = (why: string) => step("run_tests", { command: "npm test" }, `19/20 passing; failing: holdTrial — ${why}`, [19, 20]);
  const events = [
    step("run_tests", { command: TESTS }, "73/73 passing", [73, 73]),
    ...Array.from({ length: 5 }, (_, i) => read(`f${i}.ts`, [73, 73])),
    edit(1, [73, 73]), other("AssertionError: a"), edit(2, [19, 20]), other("AssertionError: b"),
  ];
  assert.equal(check(events, 100, SESSION_CONFIG), null);
});
