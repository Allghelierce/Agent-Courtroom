import type { Charge, ChargeKind, Event, Ruling, Trial, Verdict } from "@court/types";
import type { WorkerState } from "./stream";

export type { Charge, ChargeKind, Event, Ruling, Trial, Verdict };

export const COURT_URL = process.env.NEXT_PUBLIC_COURT_URL ?? "http://localhost:4100";
export const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";

// ---------- labels and formatting ----------

export const KIND_LABEL: Record<ChargeKind, string> = {
  looping: "Looping",
  stalling: "Stuck",
  overspending: "Overspending",
  flailing: "Flailing",
};

// For sentences: "worker-3 is charged with being stuck".
export const CHARGE_PHRASE: Record<ChargeKind, string> = {
  looping: "looping",
  stalling: "being stuck",
  overspending: "overspending",
  flailing: "flailing",
};

export const RULING_LABEL: Record<Ruling, string> = {
  continue: "Keep going",
  change_strategy: "Change strategy",
  escalate: "Ask a human",
  halt: "Halt",
};

export const STATE_LABEL: Record<WorkerState, string> = {
  running: "Working",
  on_trial: "On trial",
  awaiting_human: "Needs a human",
  succeeded: "All tests pass",
  halted: "Halted",
  failed: "Failed",
};

// Role colours carry meaning (ART.md): green healthy, red trouble, gold verdict, amber needs a human, soft stopped.
export const STATE_COLOR: Record<WorkerState, string> = {
  running: "var(--green)",
  on_trial: "var(--red)",
  awaiting_human: "var(--amber)",
  succeeded: "var(--green)",
  halted: "var(--soft)",
  failed: "var(--soft)",
};

export const RULING_COLOR: Record<Ruling, string> = {
  continue: "var(--green)",
  change_strategy: "var(--gold)",
  escalate: "var(--amber)",
  halt: "var(--soft)",
};

export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function clock(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function describeEvent(e: Event): string {
  const path = typeof e.args.path === "string" ? e.args.path : "";
  if (e.tool === "run_tests") return e.result ? `Ran the tests: ${e.result}` : "Ran the tests";
  if (e.tool === "read_file") return `Read ${path}`;
  if (e.tool === "edit_file") return `Edited ${path}`;
  if (e.tool === "list_files") return e.result ? `Listed files (${e.result})` : "Listed files";
  return e.result ? `${e.tool}: ${e.result}` : e.tool;
}

// The engine reports test failures in a run_tests result and tool failures in `error`.
export function eventFailed(e: Event): boolean {
  return Boolean(e.error) || (e.tool === "run_tests" && e.testsPassing < e.testsTotal);
}
