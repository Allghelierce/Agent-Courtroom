import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Event } from "../../court/src/index.ts";
import { check, DEFAULT_CONFIG, pyDumps } from "../src/monitors.ts";

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
