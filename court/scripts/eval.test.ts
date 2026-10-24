import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedRulings, formatTable, formatTotals, type Row } from "./eval.ts";

const court = fileURLToPath(new URL("..", import.meta.url));

function runEval(args: string[], env: Record<string, string>): string {
  const base = { ...process.env };
  delete base.ANTHROPIC_API_KEY;
  delete base.ANTHROPIC_AUTH_TOKEN;
  delete base.COURT_EVAL_STUB;
  delete base.COURT_MOCK;
  return execFileSync("npx", ["tsx", "scripts/eval.ts", ...args], { cwd: court, env: { ...base, ...env }, encoding: "utf8" });
}

test("without a key, eval prints one line and exits 0", () => {
  const out = runEval(["--yes"], {});
  assert.equal(out.trim().split("\n").length, 1);
  assert.match(out, /needs ANTHROPIC_API_KEY/);
});

test("COURT_MOCK=1 does not make eval fall back to the mock", () => {
  const out = runEval(["--yes"], { COURT_MOCK: "1" });
  assert.match(out, /needs ANTHROPIC_API_KEY/);
});

test("without --yes, eval prints the estimate and runs nothing", () => {
  const out = runEval([], { COURT_EVAL_STUB: "1" });
  assert.match(out, /Estimated cost: ~\$\d+\.\d\d/);
  assert.match(out, /--yes/);
  assert.doesNotMatch(out, /Matches:/);
});

test("stubbed run prints the labeled table and totals, and --save writes them", () => {
  const dir = mkdtempSync(join(tmpdir(), "court-eval-"));
  try {
    const file = join(dir, "evals", "run.json");
    const out = runEval(["--yes", "--save", file], { COURT_EVAL_STUB: "1" });
    assert.match(out, /MOCK court/);
    assert.match(out, /^fixture\s+expected\s+actual\s+match/m);
    assert.match(out, /looping-run\.json\s+change_strategy\s+change_strategy\s+yes/);
    assert.match(out, /engine-packet-checkout\.json\s+—\s+\S+\s+n\/a/);
    assert.match(out, /Matches: 4\/4 \(1 fixture with no expected ruling\)/);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.stub, true);
    assert.equal(saved.rows.length, 5);
    assert.equal(saved.trials.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expectedRulings reads the note before the colon, then falls back to ruling", () => {
  assert.deepEqual(expectedRulings({ expected: "change_strategy or escalate: real stall" }), ["change_strategy", "escalate"]);
  assert.deepEqual(expectedRulings({ ruling: "halt" }), ["halt"]);
  assert.deepEqual(expectedRulings(undefined), []);
});

test("formatTable aligns columns and flags mismatches", () => {
  const rows: Row[] = [
    { fixture: "a-run.json", expected: ["halt"], actual: "continue", match: false, citesValid: false, prosecutionCites: 3, defenseCites: 0, costUsd: 0.0312, seconds: 12.34 },
    { fixture: "longer-name-run.json", expected: ["change_strategy", "escalate"], actual: "escalate", match: true, citesValid: true, prosecutionCites: 12, defenseCites: 2, costUsd: 0.04, seconds: 8 },
  ];
  const lines = formatTable(rows).split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[2].indexOf("halt"), lines[3].indexOf("change_strategy | escalate"));
  assert.match(lines[2], /continue\s+NO\s+NO\s+3\s+0\s+\$0\.0312\s+12\.3$/);
  assert.match(formatTotals(rows), /Matches: 1\/2\nCost: \$0\.0712 total, \$0\.0356 mean per trial\nLatency: 10\.2s mean per trial/);
});
