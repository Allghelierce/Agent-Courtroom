// Run the real-model court on every fixture and compare its rulings with the expected ones.
//   npm run eval -- --yes [--save evals/<timestamp>.json]
// Costs real money, so it prints an estimate and does nothing without --yes.
// COURT_EVAL_STUB=1 runs the mock court instead, clearly labeled; it exists only for scripts/eval.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { costOf, holdTrial, modelsFor, resolveProvider } from "../src/court.ts";

const { lawyer: LAWYER_MODEL, judge: JUDGE_MODEL } = modelsFor(resolveProvider() ?? "anthropic");
import { buildPacket, fromEnginePacket } from "../src/packet.ts";
import { renderPacket } from "../src/prompts.ts";
import type { Charge, EnginePacket, Event, EvidencePacket, Ruling, Trial } from "../src/types.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);

export type Case = { name: string; packet: EvidencePacket; expected: Ruling[] };

export type Row = {
  fixture: string;
  expected: Ruling[];
  actual: Ruling;
  match: boolean | null; // null when the fixture has no expected ruling
  citesValid: boolean;
  prosecutionCites: number;
  defenseCites: number;
  costUsd: number;
  seconds: number;
};

// verdict.expected reads "<ruling> or <ruling>: why"; otherwise fall back to verdict.ruling.
export function expectedRulings(verdict: { expected?: string; ruling?: string } | undefined): Ruling[] {
  const note = verdict?.expected ?? verdict?.ruling;
  if (!note) return [];
  return note.split(":")[0].split(/\s+or\s+/).map((r) => r.trim()) as Ruling[];
}

export function loadCases(): Case[] {
  const cases: Case[] = [];
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith("-run.json")).sort()) {
    const run = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8")) as {
      budgetUsd: number;
      events: Event[];
      charge: Charge;
      verdict?: { expected?: string; ruling?: string };
    };
    cases.push({ name: file, packet: buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd }), expected: expectedRulings(run.verdict) });
  }
  // Engine-shaped fixtures: an EnginePacket itself or { packet, verdict }.
  for (const file of readdirSync(FIXTURES).filter((f) => /^engine-packet-.*\.json$/.test(f)).sort()) {
    const raw = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"));
    const ep: EnginePacket = raw.packet ?? raw;
    cases.push({ name: file, packet: fromEnginePacket(ep), expected: expectedRulings(raw.verdict) });
  }
  return cases;
}

// Rough per-trial cost: two lawyer calls and one judge call over the rendered packet (~4 chars per token).
export function estimateUsd(packet: EvidencePacket): number {
  const input = Math.ceil(renderPacket(packet).length / 4) + 500; // + system prompt
  const lawyer = costOf(LAWYER_MODEL, { input_tokens: input, output_tokens: 400 });
  const judge = costOf(JUDGE_MODEL, { input_tokens: input + 800, output_tokens: 800 });
  if (lawyer === null || judge === null) throw new Error("Unknown model price: update shared/model-prices.json before estimating spend");
  return 2 * lawyer + judge;
}

export function toRow(c: Case, trial: Trial, seconds: number): Row {
  const ids = new Set(c.packet.events.map((e) => e.id));
  const cites = [...trial.verdict.cited_events, ...trial.prosecution.cited_events, ...trial.defense.cited_events];
  return {
    fixture: c.name,
    expected: c.expected,
    actual: trial.verdict.ruling,
    match: c.expected.length ? c.expected.includes(trial.verdict.ruling) : null,
    citesValid: cites.every((id) => ids.has(id)),
    prosecutionCites: trial.prosecution.cited_events.length,
    defenseCites: trial.defense.cited_events.length,
    costUsd: trial.costUsd,
    seconds,
  };
}

export function formatTable(rows: Row[]): string {
  const header = ["fixture", "expected", "actual", "match", "cites ⊆ packet", "pros cites", "def cites", "cost USD", "secs"];
  const body = rows.map((r) => [
    r.fixture,
    r.expected.length ? r.expected.join(" | ") : "—",
    r.actual,
    r.match === null ? "n/a" : r.match ? "yes" : "NO",
    r.citesValid ? "yes" : "NO",
    String(r.prosecutionCites),
    String(r.defenseCites),
    `$${r.costUsd.toFixed(4)}`,
    r.seconds.toFixed(1),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

export function formatTotals(rows: Row[]): string {
  const scored = rows.filter((r) => r.match !== null);
  const matches = scored.filter((r) => r.match).length;
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  const secs = rows.reduce((s, r) => s + r.seconds, 0);
  const n = rows.length || 1;
  const unscored = rows.length - scored.length;
  return [
    `Matches: ${matches}/${scored.length}${unscored ? ` (${unscored} fixture${unscored > 1 ? "s" : ""} with no expected ruling)` : ""}`,
    `Cost: $${cost.toFixed(4)} total, $${(cost / n).toFixed(4)} mean per trial`,
    `Latency: ${(secs / n).toFixed(1)}s mean per trial`,
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const stub = process.env.COURT_EVAL_STUB === "1";
  if (!stub && resolveProvider() === null) {
    console.log("eval needs ANTHROPIC_API_KEY (or GROQ_API_KEY) set: it runs the real-model court and never falls back to the mock.");
    return 0;
  }

  const cases = loadCases();
  const estimate = cases.reduce((s, c) => s + estimateUsd(c.packet), 0);
  console.log(`${cases.length} fixtures, judge ${JUDGE_MODEL}, lawyers ${LAWYER_MODEL}. Estimated cost: ~$${estimate.toFixed(2)} ($${(estimate / cases.length).toFixed(3)} per trial).`);
  if (stub) console.log("COURT_EVAL_STUB=1: running the MOCK court. No model is called and these results say nothing about the real court.");
  if (!argv.includes("--yes")) {
    console.log("Re-run with --yes to spend it.");
    return 0;
  }

  const rows: Row[] = [];
  const trials: Trial[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    const trial = await holdTrial(c.packet, { mock: stub });
    const seconds = (performance.now() - t0) / 1000;
    if (trial.mock !== stub) throw new Error(`${c.name}: expected ${stub ? "mock" : "real"} court, got ${trial.mock ? "mock" : "real"}`);
    trials.push(trial);
    rows.push(toRow(c, trial, seconds));
    console.log(`  ${c.name}: ${trial.verdict.ruling} (${seconds.toFixed(1)}s, $${trial.costUsd.toFixed(4)})`);
  }

  console.log(`\n${formatTable(rows)}\n\n${formatTotals(rows)}`);

  const i = argv.indexOf("--save");
  if (i !== -1) {
    const out = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : `evals/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({ ranAt: new Date().toISOString(), stub, judgeModel: JUDGE_MODEL, lawyerModel: LAWYER_MODEL, rows, trials }, null, 2));
    console.log(`\nSaved to ${out}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
