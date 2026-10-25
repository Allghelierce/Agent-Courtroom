// Replays saved Claude Code transcripts through the plugin's mapping and checks, the way the daemon runs them
// (the window starts fresh after each charge), and counts where a court would have convened. A false-alarm
// benchmark: on ordinary sessions, most of these charges are interruptions for nothing.
//
//   npm run replay                          every transcript under ~/.claude/projects
//   npm run replay -- <dir> [--list]        another folder; --list prints each charge with the new rules
//
// Overspending is left out: transcripts don't carry the cost meter's readings. Everything stays on this machine.

import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Event } from "../../court/src/index.ts";
import { mapToolCall } from "../src/map.ts";
import { check, DEFAULT_CONFIG, SESSION_CONFIG, type MonitorConfig } from "../src/monitors.ts";

const RULES: [string, MonitorConfig][] = [
  ["engine rules", { ...DEFAULT_CONFIG, progressRequired: true }],
  ["session rules", SESSION_CONFIG],
];
const ENABLED = ["looping", "flailing", "stalling"] as const;

const args = process.argv.slice(2);
const list = args.includes("--list");
const root = args.find((a) => !a.startsWith("--")) ?? join(homedir(), ".claude/projects");

function transcripts(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? transcripts(p) : name.endsWith(".jsonl") ? [p] : [];
  });
}

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string };

const text = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((x: Block | string) => (typeof x === "string" ? x : x?.text ?? "")).join("\n") : "";

// One transcript's tool calls as the daemon would have logged them.
async function events(file: string): Promise<Event[]> {
  const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  const out: Event[] = [];
  let passing = 0, total = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    let j: { message?: { content?: unknown }; toolUseResult?: unknown; cwd?: string };
    try { j = JSON.parse(line); } catch { continue; }
    const content = j?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Block[]) {
      if (b?.type === "tool_use" && b.id) pending.set(b.id, { name: b.name ?? "", input: b.input ?? {} });
      if (b?.type !== "tool_result" || !b.tool_use_id) continue;
      const use = pending.get(b.tool_use_id);
      if (!use) continue;
      pending.delete(b.tool_use_id);
      // The hook gets the structured result; the transcript keeps it as toolUseResult.
      const response = j.toolUseResult && typeof j.toolUseResult === "object" ? j.toolUseResult : text(b.content);
      const m = mapToolCall({ tool_name: use.name, tool_input: use.input, tool_response: response, cwd: j.cwd, ...(b.is_error ? { error: text(b.content) } : {}) });
      if (m.tests) [passing, total] = [m.tests.passing, m.tests.total];
      out.push({
        id: out.length + 1, workerId: file, step: out.length + 1, tool: m.tool, args: m.args, tokens: 0, costUsd: 0,
        testsPassing: passing, testsTotal: total, result: m.result, ...(m.error ? { error: m.error } : {}), timestamp: "",
      });
    }
  }
  return out;
}

type Tally = { charges: number; sessions: number; byKind: Record<string, number>; lines: string[] };
const tallies = RULES.map((): Tally => ({ charges: 0, sessions: 0, byKind: {}, lines: [] }));
let sessions = 0, calls = 0;

for (const file of transcripts(root)) {
  const evs = await events(file);
  if (!evs.length) continue;
  sessions++;
  calls += evs.length;
  RULES.forEach(([, cfg], r) => {
    const t = tallies[r];
    let windowStart = 0, fired = false;
    for (let i = 1; i <= evs.length; i++) {
      const f = check(evs.slice(windowStart, i), 5, cfg, ENABLED);
      if (!f) continue;
      t.charges++;
      t.byKind[f.kind] = (t.byKind[f.kind] ?? 0) + 1;
      t.lines.push(`${f.kind} at step ${i} of ${file}: ${f.summary.slice(0, 200)}`);
      fired = true;
      windowStart = i;
    }
    if (fired) t.sessions++;
  });
}

console.log(`${sessions} sessions, ${calls} tool calls, under ${root}\n`);
RULES.forEach(([name], r) => {
  const t = tallies[r];
  const kinds = ENABLED.map((k) => `${k} ${t.byKind[k] ?? 0}`).join(", ");
  console.log(`${name.padEnd(14)} ${String(t.charges).padStart(5)} charges in ${t.sessions} sessions (${kinds}), ${((1000 * t.charges) / Math.max(calls, 1)).toFixed(2)} per 1,000 tool calls`);
});
if (list) console.log(`\n${tallies[tallies.length - 1].lines.join("\n")}`);
