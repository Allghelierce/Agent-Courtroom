// Summary judgment: rulings decided by plain code before any model is called.
// - Repeat offender: charged again soon after a change_strategy ruling means the new
//   strategy didn't work, so skip the trial and escalate; charged again after that, halt.
// - Court budget: the court may not outspend a small share of what the worker has spent,
//   nor hold more than a few trials an hour per worker. Past either cap, escalate.
// Both need the worker's earlier trials (CourtOptions.past), which the server supplies.
import type { Argument, EvidencePacket, Trial, Verdict } from "./types.ts";

export type SummaryKind = "repeat_offender" | "court_budget";

export type RulesConfig = {
  enabled: boolean;
  budgetFraction: number; // court spend per worker may not exceed this share of the worker's spend...
  budgetFloorUsd: number; // ...or this floor, whichever is larger, so early trials always run
  maxTrialsPerHour: number; // full trials per worker per rolling hour
  repeatWindowMin: number; // a charge this soon after the last ruling counts as a repeat
};

export function rulesConfig(env: NodeJS.ProcessEnv = process.env): RulesConfig {
  const num = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return env[name] !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    enabled: env.COURT_RULES !== "off",
    budgetFraction: num("COURT_BUDGET_FRACTION", 0.05),
    budgetFloorUsd: num("COURT_BUDGET_FLOOR_USD", 0.05),
    maxTrialsPerHour: num("COURT_MAX_TRIALS_PER_HOUR", 6),
    repeatWindowMin: num("COURT_REPEAT_WINDOW_MIN", 30),
  };
}

export type Summary = {
  kind: SummaryKind;
  verdict: Verdict;
  prosecution: string;
  defense: string;
  priorCaseIds: string[];
};

const HOUR_MS = 60 * 60 * 1000;

export function summaryJudgment(packet: EvidencePacket, past: Trial[], cfg: RulesConfig = rulesConfig(), now = Date.now()): Summary | null {
  if (!cfg.enabled) return null;
  // Same worker AND same run: engine `run`/`compare` restart worker IDs, so an old run's
  // "worker-1" must not count against a new one. Unknown run start: take no history.
  const since = packet.runSince ? Date.parse(packet.runSince) : NaN;
  if (!Number.isFinite(since)) return null;
  const mine = past
    .filter((t) => t.workerId === packet.workerId && Date.parse(t.finishedAt) >= since)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const cited = packet.charge.eventIds;
  const last = mine.at(-1);
  const minutesAgo = last ? (now - Date.parse(last.finishedAt)) / 60_000 : Infinity;

  // Repeat offender. A "continue" ruling, or a quiet spell longer than the window, resets it.
  if (last && minutesAgo <= cfg.repeatWindowMin) {
    const ago = minutesAgo < 1 ? "under a minute" : `${Math.round(minutesAgo)} minutes`;
    if (last.summary === "repeat_offender" && last.verdict.ruling === "escalate") {
      return {
        kind: "repeat_offender",
        verdict: {
          ruling: "halt",
          reasoning: `Third charge in a row: ${last.id} already escalated a repeat offense ${ago} ago, and the worker was charged again (${packet.charge.kind}). Further work is not paying off, so the run stops.`,
          cited_events: cited,
        },
        prosecution: `Charged a third time. ${last.id} escalated the last repeat offense ${ago} ago, and the worker is stuck again.`,
        defense: "The defense was not heard: a third offense is decided without a trial.",
        priorCaseIds: [last.id],
      };
    }
    if (last.verdict.ruling === "change_strategy") {
      return {
        kind: "repeat_offender",
        verdict: {
          ruling: "escalate",
          reasoning: `Charged again (${packet.charge.kind}) ${ago} after ${last.id} ordered a new strategy ("${clip(last.verdict.instruction ?? "", 140)}"). The new strategy didn't work, so a human should decide instead of another trial.`,
          cited_events: cited,
        },
        prosecution: `The worker was charged again ${ago} after ${last.id} gave it a new strategy. The court's order didn't work.`,
        defense: "The defense was not heard: a repeat offense goes straight to a human.",
        priorCaseIds: [last.id],
      };
    }
  }

  // Court budget. Summary rulings cost nothing and aren't counted as trials.
  const full = mine.filter((t) => !t.summary);
  const spent = full.reduce((s, t) => s + t.costUsd, 0);
  const cap = Math.max(cfg.budgetFloorUsd, cfg.budgetFraction * packet.spend.usd);
  const lastHour = full.filter((t) => now - Date.parse(t.finishedAt) < HOUR_MS);
  const overSpend = spent >= cap;
  const overCount = lastHour.length >= cfg.maxTrialsPerHour;
  if (overSpend || overCount) {
    const why = overSpend
      ? `the court has already spent $${spent.toFixed(4)} on this worker, its cap of $${cap.toFixed(4)} (${Math.round(cfg.budgetFraction * 100)}% of the worker's $${packet.spend.usd.toFixed(2)}, minimum $${cfg.budgetFloorUsd.toFixed(2)})`
      : `the court has held ${lastHour.length} trials for this worker in the last hour, its limit`;
    return {
      kind: "court_budget",
      verdict: { ruling: "escalate", reasoning: `No trial held: ${why}. Oversight must not become the waste it is meant to stop, so a human decides.`, cited_events: cited },
      prosecution: `The court's own budget for this worker is spent: ${why}.`,
      defense: "The defense was not heard: the court is over its budget.",
      priorCaseIds: (overSpend ? full : lastHour).map((t) => t.id),
    };
  }
  return null;
}

export function summaryArgument(side: Argument["side"], text: string): Argument {
  return { side, model: "none", argument: text, cited_events: [], costUsd: 0, costComplete: true };
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
