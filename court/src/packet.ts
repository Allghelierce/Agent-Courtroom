import type { Charge, Event, EvidencePacket } from "./types.ts";

export type PacketOptions = {
  budgetUsd: number;
  window?: number; // how many recent events the court sees (default 15)
};

// Stable key for "the same call": tool plus args with sorted keys.
export function callKey(e: Event): string {
  return `${e.tool}:${stableStringify(e.args)}`;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function buildPacket(charge: Charge, allEvents: Event[], opts: PacketOptions): EvidencePacket {
  const window = opts.window ?? 15;
  const mine = allEvents.filter((e) => e.workerId === charge.workerId).sort((a, b) => a.step - b.step);

  // Recent window, plus any charged events that fell outside it.
  const recent = mine.slice(-window);
  const ids = new Set(recent.map((e) => e.id));
  const extra = mine.filter((e) => charge.eventIds.includes(e.id) && !ids.has(e.id));
  const events = [...extra, ...recent].sort((a, b) => a.step - b.step);

  const usd = mine.reduce((s, e) => s + e.costUsd, 0);

  const groups = new Map<string, Event[]>();
  for (const e of recent) {
    const k = callKey(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const repeatedCalls = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ tool: g[0].tool, args: stableStringify(g[0].args), count: g.length, eventIds: g.map((e) => e.id) }))
    // Groups touching the charged events first: run_tests {} repeats in every run, so count alone misleads.
    .sort((a, b) => overlap(b.eventIds, charge.eventIds) - overlap(a.eventIds, charge.eventIds) || b.count - a.count);

  const errors = recent.filter((e) => e.error).map((e) => e.error as string);

  let best = -1;
  let bestStep = 0;
  for (const e of mine) {
    if (e.testsPassing > best) {
      best = e.testsPassing;
      bestStep = e.step;
    }
  }
  const lastStep = mine.at(-1)?.step ?? 0;

  return {
    charge,
    workerId: charge.workerId,
    events,
    progress: mine.map((e) => ({ step: e.step, testsPassing: e.testsPassing, testsTotal: e.testsTotal })),
    spend: { usd: round(usd), budgetUsd: opts.budgetUsd, fractionOfBudget: round(usd / opts.budgetUsd) },
    stats: {
      totalSteps: mine.length,
      errorsInWindow: errors.length,
      distinctErrors: [...new Set(errors)],
      lastError: errors.at(-1) ?? null,
      repeatedCalls,
      stepsSinceProgress: lastStep - bestStep,
    },
  };
}

function overlap(a: number[], b: number[]): number {
  return a.filter((x) => b.includes(x)).length;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
