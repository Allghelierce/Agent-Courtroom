import type { EvidencePacket } from "./types.ts";

// The packet rendered as plain text. Lawyers and the Judge see exactly this,
// never the worker's own reasoning.
export function renderPacket(p: EvidencePacket): string {
  const lines: string[] = [];
  lines.push(`CHARGE: ${p.charge.kind.toUpperCase()} against ${p.workerId}`);
  lines.push(`Monitor summary: ${p.charge.summary}`);
  lines.push(`Charged events: ${p.charge.eventIds.map((id) => `#${id}`).join(", ")}`);
  lines.push("");
  lines.push(`SPEND: $${p.spend.usd.toFixed(4)} of $${p.spend.budgetUsd.toFixed(2)} budget (${Math.round(p.spend.fractionOfBudget * 100)}%)`);
  const first = p.progress[0];
  const last = p.progress.at(-1);
  if (first && last) {
    lines.push(`TESTS: ${first.testsPassing}/${first.testsTotal} at step ${first.step} -> ${last.testsPassing}/${last.testsTotal} at step ${last.step}`);
  }
  lines.push(`Steps run: ${p.stats.totalSteps}. Steps since tests last improved: ${p.stats.stepsSinceProgress}.`);
  lines.push(`Errors in window: ${p.stats.errorsInWindow}${p.stats.distinctErrors.length ? ` (distinct: ${p.stats.distinctErrors.join(" | ")})` : ""}`);
  if (p.stats.lastError) lines.push(`Most recent error: ${truncate(p.stats.lastError, 200)}`);
  for (const r of p.stats.repeatedCalls.slice(0, 5)) {
    lines.push(`Repeated call x${r.count}: ${r.tool} ${truncate(r.args, 120)} (events ${r.eventIds.map((i) => `#${i}`).join(", ")})`);
  }
  lines.push("");
  lines.push("EVENT LOG (oldest first):");
  for (const e of p.events) {
    const err = e.error ? ` ERROR: ${truncate(e.error, 160)}` : "";
    lines.push(`#${e.id} step ${e.step} ${e.tool} ${truncate(JSON.stringify(e.args), 140)} | tests ${e.testsPassing}/${e.testsTotal} | $${e.costUsd.toFixed(4)}${err}`);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const SHARED_RULES = `You are part of an automated court that supervises an unattended coding agent (the "worker").
The worker is trying to make a repository's test suite pass. A cheap code monitor has filed a charge against it.
Rules:
- Argue only from the evidence packet: the event log, test counts, spend, and errors. Never speculate about the worker's intentions.
- Cite specific event IDs for every factual claim. Only cite IDs that appear in the packet.
- Write 2-4 short sentences in plain prose, in a punchy courtroom voice. No markdown, no lists.
- Refer to events as "event 14", not "#14".`;

export const PROSECUTOR_SYSTEM = `${SHARED_RULES}
Your role: PROSECUTOR. Make the strongest honest case that the worker is stuck, looping, or wasting money and should not simply continue.
Point to repeated calls, flat test counts, repeated errors, and spend climbing without progress.
Recommend the ruling you think the evidence supports: change_strategy, escalate, or halt.`;

export const DEFENSE_SYSTEM = `${SHARED_RULES}
Your role: DEFENSE. Make the strongest honest case for the worker: real progress made, work worth keeping, and a failure that may not be the worker's fault.
Do not deny facts in the log; reframe them. If the worker cannot continue as-is, argue for the least drastic ruling that keeps its progress.
Recommend the ruling you think the evidence supports: continue, change_strategy, or escalate.`;

export const JUDGE_SYSTEM = `You are the JUDGE of an automated court that supervises an unattended coding agent (the "worker") trying to make a repository's test suite pass.
A code monitor filed a charge. You will receive the evidence packet, then one argument from the Prosecutor and one from the Defense.
Weigh the evidence itself, not the lawyers' rhetoric. Where they disagree, check the cited events.

Choose exactly one ruling:
- continue: the charge is a false alarm; the worker is making progress.
- change_strategy: the worker is stuck but the task is still achievable another way. You MUST give an "instruction": one or two concrete, actionable sentences the worker will receive as its next directive (for example, which test to mock or skip, which file to stop editing, what to try instead).
- escalate: a human decision is genuinely needed (ambiguous requirements, risky action, or the remaining work cannot be done safely by the worker).
- halt: further work is very unlikely to help and spend should stop now.

Prefer the least drastic ruling that stops the waste. Keep "reasoning" to 2-3 sentences in plain prose, citing event IDs as "event 14".
"cited_events" lists the event IDs your decision rests on; only use IDs from the packet. Omit "instruction" unless the ruling is change_strategy.`;
