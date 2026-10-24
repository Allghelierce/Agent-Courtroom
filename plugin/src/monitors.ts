// Port of engine/courtroom_engine/monitors.py. Same rules, same order, same summaries,
// so a charge filed here reads exactly like one the engine files (test/monitors.test.ts
// checks this against the Python). Each check sees only the events since the last ruling.

import type { ChargeKind, Event } from "../../court/src/index.ts";

export type Finding = { kind: ChargeKind; summary: string; eventIds: number[] };

export type MonitorConfig = {
  loopRepeats: number; // same action + same outcome this many times...
  loopWindow: number; // ...within this many steps
  stallSteps: number; // no new passing test in this many steps
  budgetFraction: number; // charge once spend passes this share of the budget
  costPerTestUsd: number; // charge when spend per newly passing test is above this
  costPerTestMinSteps: number;
  errorStreak: number; // this many tool errors in a row
  sameErrorRepeats: number; // or the same error this many times in the window
  // Plugin-only guards for open-ended sessions with no test suite. Off by default (engine behavior).
  progressRequired: boolean; // stalling and the per-test spend rule need a test count in the window
};

export const DEFAULT_CONFIG: MonitorConfig = {
  loopRepeats: 3,
  loopWindow: 10,
  stallSteps: 8,
  budgetFraction: 0.8,
  costPerTestUsd: 0.5,
  costPerTestMinSteps: 6,
  errorStreak: 3,
  sameErrorRepeats: 3,
  progressRequired: false,
};

// Python's json.dumps(v, sort_keys=True): ", " and ": " separators, non-ASCII escaped.
export function pyDumps(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === "string") return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(", ")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${pyDumps(k)}: ${pyDumps(o[k])}`).join(", ")}}`;
}

function pyFloat(n: number): string {
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

function actionKey(e: Event): string {
  return pyDumps([e.tool, e.args, e.result ?? null, e.error || null]);
}

// Counter.most_common(1): highest count, ties go to the key seen first.
function mostCommon<T>(items: T[]): [T, number] | null {
  const counts = new Map<T, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: [T, number] | null = null;
  for (const [k, n] of counts) if (!best || n > best[1]) best = [k, n];
  return best;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const hasProgress = (events: Event[]) => events.some((e) => e.testsTotal > 0);

export function looping(events: Event[], cfg: MonitorConfig): Finding | null {
  const window = events.slice(-cfg.loopWindow);
  const top = mostCommon(window.map(actionKey));
  if (!top || top[1] < cfg.loopRepeats) return null;
  const repeats = window.filter((e) => actionKey(e) === top[0]);
  const first = repeats[0];
  return {
    kind: "looping",
    summary: `${first.tool}(${pyDumps(first.args)}) repeated ${top[1]} times in the last ${window.length} steps with the same result: ${first.error || first.result || "None"}`,
    eventIds: repeats.map((e) => e.id),
  };
}

export function stalling(events: Event[], cfg: MonitorConfig): Finding | null {
  if (events.length < cfg.stallSteps) return null;
  const recent = events.slice(-cfg.stallSteps);
  if (cfg.progressRequired && !hasProgress(recent)) return null;
  const before = events.length > cfg.stallSteps ? events[events.length - cfg.stallSteps - 1].testsPassing : recent[0].testsPassing;
  if (Math.max(...recent.map((e) => e.testsPassing)) > before) return null;
  const last = recent[recent.length - 1];
  return {
    kind: "stalling",
    summary: `Passing tests stuck at ${last.testsPassing}/${last.testsTotal} for ${cfg.stallSteps} steps`,
    eventIds: recent.map((e) => e.id),
  };
}

export function overspending(events: Event[], cfg: MonitorConfig, budgetUsd: number): Finding | null {
  const spent = events.reduce((s, e) => s + e.costUsd, 0);
  const lastFive = events.slice(-5).map((e) => e.id);
  if (budgetUsd > 0 && spent >= cfg.budgetFraction * budgetUsd) {
    return { kind: "overspending", summary: `Spent ${usd(spent)} of the ${usd(budgetUsd)} budget since the last ruling`, eventIds: lastFive };
  }
  if (events.length < cfg.costPerTestMinSteps) return null;
  if (cfg.progressRequired && !hasProgress(events)) return null;
  const gained = events[events.length - 1].testsPassing - events[0].testsPassing;
  if (gained <= 0 && spent > cfg.costPerTestUsd) {
    return { kind: "overspending", summary: `Spent ${usd(spent)} over ${events.length} steps with no newly passing tests`, eventIds: lastFive };
  }
  if (gained > 0 && spent / gained > cfg.costPerTestUsd) {
    return { kind: "overspending", summary: `${usd(spent / gained)} per newly passing test (limit ${usd(cfg.costPerTestUsd)})`, eventIds: lastFive };
  }
  return null;
}

export function flailing(events: Event[], cfg: MonitorConfig): Finding | null {
  const streak: Event[] = [];
  for (let i = events.length - 1; i >= 0 && events[i].error; i--) streak.unshift(events[i]);
  if (streak.length >= cfg.errorStreak) {
    return { kind: "flailing", summary: `${streak.length} tool errors in a row, latest: ${streak[streak.length - 1].error}`, eventIds: streak.map((e) => e.id) };
  }
  const window = events.slice(-cfg.loopWindow);
  const top = mostCommon(window.filter((e) => e.error).map((e) => e.error as string));
  if (top && top[1] >= cfg.sameErrorRepeats) {
    return {
      kind: "flailing",
      summary: `Same error ${top[1]} times in the last ${window.length} steps: ${top[0]}`,
      eventIds: window.filter((e) => e.error === top[0]).map((e) => e.id),
    };
  }
  return null;
}

// Checked in this order; the first one that fires files the charge.
export const ALL_MONITORS = ["looping", "flailing", "stalling", "overspending"] as const;
export type MonitorName = (typeof ALL_MONITORS)[number];

export function check(events: Event[], budgetUsd: number, cfg: MonitorConfig = DEFAULT_CONFIG, enabled: readonly MonitorName[] = ALL_MONITORS): Finding | null {
  for (const name of enabled) {
    const f =
      name === "looping" ? looping(events, cfg)
      : name === "flailing" ? flailing(events, cfg)
      : name === "stalling" ? stalling(events, cfg)
      : overspending(events, cfg, budgetUsd);
    if (f) return f;
  }
  return null;
}
