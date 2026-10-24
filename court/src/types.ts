// Shared contracts. Mirrors shared/schema.ts on Amelia's branch (Person A);
// switch to importing it once that file is on this branch.

export type Event = {
  id: number;
  workerId: string;
  step: number;
  tool: "read_file" | "edit_file" | "run_tests" | (string & {});
  args: Record<string, unknown>;
  tokens: number;
  costUsd: number;
  testsPassing: number;
  testsTotal: number;
  error?: string | null;
  result?: string; // short summary of the tool output
  timestamp: string;
};

export type ChargeKind = "looping" | "overspending" | "stalling" | "flailing";

export type Charge = {
  id?: number; // set by the engine; lets a verdict point back at its charge
  workerId: string;
  kind: ChargeKind;
  summary: string;
  eventIds: number[];
};

export type Ruling = "continue" | "change_strategy" | "escalate" | "halt";

export type Verdict = {
  ruling: Ruling;
  instruction?: string;
  reasoning: string;
  cited_events: number[];
};

// ---- Court-internal types (also what the UI and case log render) ----

// What the engine POSTs (shared/schema.ts EvidencePacket).
export type EnginePacket = {
  charge: Charge;
  events: Event[];
  testProgress: { step: number; testsPassing: number; testsTotal: number }[];
  spend: { costUsd: number; budgetUsd: number };
  task: string;
};

// The court's enriched packet, built from an EnginePacket or a raw event log.
export type EvidencePacket = {
  charge: Charge;
  workerId: string;
  task?: string;
  events: Event[]; // the last N events for this worker, oldest first
  progress: { step: number; testsPassing: number; testsTotal: number }[];
  spend: { usd: number; budgetUsd: number; fractionOfBudget: number };
  stats: {
    totalSteps: number;
    errorsInWindow: number;
    distinctErrors: string[];
    lastError: string | null;
    repeatedCalls: { tool: string; args: string; count: number; eventIds: number[] }[];
    stepsSinceProgress: number;
  };
};

export type Side = "prosecution" | "defense";

export type Argument = {
  side: Side;
  model: string;
  argument: string;
  cited_events: number[]; // only IDs that exist in the packet
  costUsd: number;
};

export type Trial = {
  id: string;
  workerId: string;
  charge: Charge;
  prosecution: Argument;
  defense: Argument;
  verdict: Verdict;
  precedents?: string[]; // ids of earlier trials shown to the Judge
  judgeModel: string;
  costUsd: number; // total court spend for this trial
  startedAt: string;
  finishedAt: string;
  mock: boolean; // true when no model was called
};
