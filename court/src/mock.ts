// Deterministic court used when no API credentials are set (and in tests).
// Builds arguments and a verdict from the packet's numbers alone.
import type { Argument, EvidencePacket, Side, Verdict } from "./types.ts";

export function mockArgument(side: Side, p: EvidencePacket): Argument {
  const last = p.events.at(-1);
  const first = p.progress[0];
  const top = p.stats.repeatedCalls[0];
  const err = p.stats.lastError;
  const progressed = p.events.filter((e, i, arr) => i > 0 && e.testsPassing > arr[i - 1].testsPassing);
  const pct = Math.round(p.spend.fractionOfBudget * 100);

  if (side === "prosecution") {
    const parts = [
      top
        ? `The worker has made the same ${top.tool} call ${top.count} times, at events ${top.eventIds.join(", ")}.`
        : `The monitor charged ${p.charge.kind} at events ${p.charge.eventIds.join(", ")}.`,
      `Tests have not improved in ${p.stats.stepsSinceProgress} steps while spend reached $${p.spend.usd.toFixed(2)}, ${pct}% of budget.`,
      err ? `The same failure keeps coming back: ${err}.` : "",
      "The worker is going in circles, and the court should change its strategy before more money burns.",
    ];
    const cited = top ? top.eventIds : p.charge.eventIds;
    return { side, model: "mock", argument: parts.filter(Boolean).join(" "), cited_events: cited, costUsd: 0 };
  }

  const progressIds = progressed.map((e) => e.id).slice(-3);
  const parts = [
    first && last
      ? `The worker took the suite from ${first.testsPassing} to ${last.testsPassing} of ${last.testsTotal} passing${progressIds.length ? `, at events ${progressIds.join(", ")}` : ""}.`
      : "",
    err ? `The remaining failure is "${err}", an error the worker's code edits cannot fix.` : "",
    "That progress is worth keeping. Redirect the worker; do not halt it.",
  ];
  return { side, model: "mock", argument: parts.filter(Boolean).join(" "), cited_events: progressIds, costUsd: 0 };
}

export function mockVerdict(p: EvidencePacket): Verdict {
  const cited = [...new Set([...p.charge.eventIds, ...(p.stats.repeatedCalls[0]?.eventIds ?? [])])].sort((a, b) => a - b);
  const err = p.stats.lastError;

  // False alarm: tests rose across the charged events, so the "repeats" are progress.
  const charged = p.events.filter((e) => p.charge.eventIds.includes(e.id));
  const last = p.events.at(-1);
  if (charged.length && last && last.testsPassing > charged[0].testsPassing && p.spend.fractionOfBudget < 0.9) {
    return {
      ruling: "continue",
      reasoning: `Tests rose from ${charged[0].testsPassing} to ${last.testsPassing} across the charged events, so the repeated calls are progress, not a loop.`,
      cited_events: charged.map((e) => e.id),
    };
  }
  if (p.spend.fractionOfBudget >= 0.9) {
    return { ruling: "halt", reasoning: `Spend is at ${Math.round(p.spend.fractionOfBudget * 100)}% of budget with no recent progress, so further work is not worth the cost.`, cited_events: cited };
  }
  if (p.charge.kind === "flailing" && p.stats.errorsInWindow >= 5) {
    return { ruling: "escalate", reasoning: `The worker hit ${p.stats.errorsInWindow} errors in its recent steps without a clear way forward, so a human should decide.`, cited_events: cited };
  }
  const external = err && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|unreachable/i.test(err);
  const instruction = external
    ? "Stop editing the code for the failing test. The external API it calls is unreachable: mock that API in the test, mark the test for human review, and finish the rest of the suite."
    : "Stop repeating the last change. Re-read the failing test's assertion, try a different fix, and if it still fails after one attempt, skip the test and flag it for human review.";
  return {
    ruling: "change_strategy",
    instruction,
    reasoning: `The worker repeated the same action at events ${cited.join(", ")} with no new tests passing, but most of the suite is fixed and the task is still achievable another way.`,
    cited_events: cited,
  };
}
