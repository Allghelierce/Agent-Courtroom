// Reads a test count out of tool output, so a Claude Code session gets the same
// testsPassing / testsTotal the engine's workers report. Returns null when the
// output isn't from a test run we recognize.

export type TestRun = { passing: number; total: number; failing: string[] };

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

const num = (m: RegExpMatchArray | null, i = 1) => (m ? Number(m[i]) : 0);

export function parseTestRun(raw: string): TestRun | null {
  const text = stripAnsi(raw);
  const failing = failingNames(text);

  // unittest: "Ran 11 tests in 0.04s" then "OK" / "FAILED (failures=1, errors=2, skipped=1)"
  const ran = text.match(/^Ran (\d+) tests? in /m);
  if (ran) {
    const total = Number(ran[1]);
    const verdict = text.match(/^(OK|FAILED)\b(?: \(([^)]*)\))?/m);
    const counts = verdict?.[2] ?? "";
    const bad = num(counts.match(/failures=(\d+)/)) + num(counts.match(/errors=(\d+)/));
    const skipped = num(counts.match(/skipped=(\d+)/));
    return { passing: total - bad - skipped, total, failing };
  }

  // jest: "Tests:       1 failed, 2 skipped, 10 passed, 13 total"
  const jest = text.match(/^Tests:\s+(.*\d+ total)/m);
  if (jest) {
    const total = num(jest[1].match(/(\d+) total/));
    return { passing: num(jest[1].match(/(\d+) passed/)), total, failing };
  }

  // vitest: " Tests  1 failed | 10 passed (11)"
  const vitest = text.match(/^\s*Tests\s+(.*)\((\d+)\)\s*$/m);
  if (vitest && /passed|failed/.test(vitest[1])) {
    return { passing: num(vitest[1].match(/(\d+) passed/)), total: Number(vitest[2]), failing };
  }

  // node:test: "ℹ tests 65" ... "ℹ pass 64" (or the TAP "# tests 65" / "# pass 64")
  const nodeTotal = text.match(/^[ℹ#] tests (\d+)$/m);
  if (nodeTotal) return { passing: num(text.match(/^[ℹ#] pass (\d+)$/m)), total: Number(nodeTotal[1]), failing };

  // cargo: "test result: FAILED. 5 passed; 1 failed; 0 ignored"
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)];
  if (cargo.length) {
    const passing = cargo.reduce((s, m) => s + Number(m[1]), 0);
    return { passing, total: passing + cargo.reduce((s, m) => s + Number(m[2]), 0), failing };
  }

  // pytest summary line: "==== 2 failed, 9 passed, 1 skipped in 0.12s ====" (or "9 passed in 0.1s")
  const pytest = text.match(/^=+ (.*\d+ (?:passed|failed|errors?)[^=]*) in [\d.]+s[^=]*=+$/m);
  if (pytest) {
    const s = pytest[1];
    const passing = num(s.match(/(\d+) passed/));
    const total = passing + num(s.match(/(\d+) failed/)) + num(s.match(/(\d+) errors?/));
    return { passing, total, failing };
  }

  return null;
}

// Names of failing tests, sorted and unique, from the common runners' failure lines.
function failingNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/^(?:FAIL|ERROR): (\w+)/gm)) names.add(m[1]); // unittest
  for (const m of text.matchAll(/^(?:FAILED|ERROR) [^\s:]+::(?:\w+::)*(\w+)/gm)) names.add(m[1]); // pytest -rA / short summary
  for (const m of text.matchAll(/^\s*● (?:.* › )?(.+?)\s*$/gm)) names.add(m[1]); // jest
  for (const m of text.matchAll(/^✖ (.+?) \([\d.]+m?s\)$/gm)) if (!/^failing tests:?$/.test(m[1])) names.add(m[1]); // node:test
  for (const m of text.matchAll(/^test (\S+) \.\.\. FAILED$/gm)) names.add(m[1]); // cargo
  return [...names].sort();
}

// The first line that looks like the reason a test failed, for "— <first failure>".
export function firstFailure(raw: string): string | null {
  const text = stripAnsi(raw);
  const m = text.match(/^\s*(?:E\s+)?((?:[\w.]+(?:Error|Exception)|AssertionError|assert)\b.*)$/m);
  return m ? m[1].trim().slice(0, 160) : null;
}
