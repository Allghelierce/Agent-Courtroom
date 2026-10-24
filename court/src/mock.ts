// Deterministic court used when no API credentials are set (and in tests).
// Builds arguments and a verdict from the packet's numbers alone.
import type { Argument, EvidencePacket, Side, Verdict } from "./types.ts";

// Errors a code edit can't fix: the test depends on something outside the repo.
const UNREACHABLE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|connection refused|URLError|timed out|network|unreachable/i;

// "5/11 passing; failing: a, b, c, d — Error: x" -> "5/11 passing; failing: a … and 3 more — Error: x"
export function shortenFailure(s: string, keep = 2): string {
  return s.replace(/(failing: )([^—\n]*?)(\s*—|$)/, (_, head: string, list: string, tail: string) => {
    const names = list.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length <= keep + 1) return `${head}${list}${tail}`;
    return `${head}${names.slice(0, keep).join(", ")} … and ${names.length - keep} more${tail}`;
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

function eventList(ids: number[]): string {
  return `${ids.length === 1 ? "event" : "events"} ${ids.join(", ")}`;
}

function prosecutionClosing(p: EvidencePacket): string {
  switch (p.charge.kind) {
    case "stalling":
      return `No test has newly passed in ${plural(p.stats.stepsSinceProgress, "step")}. The worker is stuck, and the court should give it a new plan.`;
    case "overspending": {
      // Spend since tests last improved, from the events in the packet.
      const since = p.events.filter((e) => e.step > (p.events.at(-1)?.step ?? 0) - p.stats.stepsSinceProgress);
      const usd = since.reduce((s, e) => s + e.costUsd, 0);
      return `$${usd.toFixed(2)} burned over ${plural(p.stats.stepsSinceProgress, "step")} with no newly passing tests. Every further step is money the worker cannot justify.`;
    }
    case "flailing": {
      const latest = p.stats.distinctErrors.at(-1);
      return `The worker hit ${plural(p.stats.errorsInWindow, "tool error")}${latest ? `, most recently "${latest}"` : ""}. It is flailing, not fixing.`;
    }
    default:
      return "The worker is going in circles, and the court should change its strategy before more money burns.";
  }
}

export function mockArgument(side: Side, p: EvidencePacket): Argument {
  const last = p.events.at(-1);
  const first = p.progress[0];
  const top = p.stats.repeatedCalls[0];
  const err = p.stats.lastError ? shortenFailure(p.stats.lastError) : null;
  const unreachable = !!p.stats.lastError && UNREACHABLE.test(p.stats.lastError);
  const progressed = p.events.filter((e, i, arr) => i > 0 && e.testsPassing > arr[i - 1].testsPassing);
  const pct = Math.round(p.spend.fractionOfBudget * 100);

  if (side === "prosecution") {
    const parts = [
      top
        ? `The worker has made the same ${top.tool} call ${times(top.count)}, at events ${top.eventIds.join(", ")}.`
        : `The monitor charged ${p.charge.kind} at events ${p.charge.eventIds.join(", ")}.`,
      // The closing carries the stalled steps or the spend for those charges, so don't say it twice.
      p.charge.kind === "stalling"
        ? `Spend has reached $${p.spend.usd.toFixed(2)}, ${pct}% of budget.`
        : p.charge.kind === "overspending"
          ? `Spend is at ${pct}% of budget.`
          : `Tests have not improved in ${plural(p.stats.stepsSinceProgress, "step")} while spend reached $${p.spend.usd.toFixed(2)}, ${pct}% of budget.`,
      err ? `The same failure keeps coming back: ${err}.` : "",
      prosecutionClosing(p),
    ];
    const cited = top ? top.eventIds : p.charge.eventIds;
    return { side, model: "mock", argument: parts.filter(Boolean).join(" "), cited_events: cited, costUsd: 0 };
  }

  const gained = !!(first && last && last.testsPassing > first.testsPassing);
  const progressIds = progressed.map((e) => e.id).slice(-3);
  let opening = "";
  let cited = progressIds;
  if (gained) {
    opening = `The worker took the suite from ${first.testsPassing} to ${last!.testsPassing} of ${last!.testsTotal} passing${progressIds.length ? `, at ${eventList(progressIds)}` : ""}.`;
  } else {
    // No gain to point at, so argue from the shape of the work.
    const pathsOf = (tool: string) => new Set(p.events.filter((e) => e.tool === tool).map((e) => String(e.args.path ?? "")).filter(Boolean));
    const reads = pathsOf("read_file").size;
    const edits = p.events.filter((e) => e.tool === "edit_file");
    const editPaths = pathsOf("edit_file").size;
    const runs = p.events.filter((e) => e.tool === "run_tests").length;
    const work = [
      reads ? `read ${plural(reads, "distinct file")}` : "",
      edits.length ? `made ${plural(edits.length, "targeted edit")} across ${plural(editPaths, "file")}` : "",
      runs ? `run the tests ${times(runs)}` : "",
    ].filter(Boolean);
    if (work.length) opening = `In this window the worker has ${work.length > 1 ? `${work.slice(0, -1).join(", ")}${work.length > 2 ? "," : ""} and ${work.at(-1)}` : work[0]}: it is investigating, not spinning.`;
    cited = p.events.filter((e) => e.tool === "edit_file" || e.tool === "read_file").map((e) => e.id).slice(-3);
  }
  const parts = [
    opening,
    err && unreachable ? `The remaining failure is "${err}", an error the worker's code edits cannot fix.` : "",
    err && !unreachable ? `The failures left (${err}) are ordinary test failures, the kind this worker exists to fix.` : "",
    gained ? "That progress is worth keeping. Redirect the worker; do not halt it." : "Give it room to finish; do not halt it.",
  ];
  return { side, model: "mock", argument: parts.filter(Boolean).join(" "), cited_events: cited, costUsd: 0 };
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
  // Premature stall: the worker has barely tested since the stall began and hit no
  // tool errors, so it is still reading and editing, not stuck.
  const testRuns = charged.filter((e) => e.tool === "run_tests").length;
  if (p.charge.kind === "stalling" && charged.length && testRuns <= 1 && !charged.some((e) => e.error)) {
    return {
      ruling: "continue",
      reasoning: `Only ${testRuns} test run in the charged window; the worker is still reading and editing, so the stall is premature.`,
      cited_events: charged.map((e) => e.id),
    };
  }
  if (p.spend.fractionOfBudget >= 0.9) {
    return { ruling: "halt", reasoning: `Spend is at ${Math.round(p.spend.fractionOfBudget * 100)}% of budget with no recent progress, so further work is not worth the cost.`, cited_events: cited };
  }
  if (p.charge.kind === "flailing" && p.stats.errorsInWindow >= 5) {
    return { ruling: "escalate", reasoning: `The worker hit ${p.stats.errorsInWindow} errors in its recent steps without a clear way forward, so a human should decide.`, cited_events: cited };
  }
  const external = err && UNREACHABLE.test(err);
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
