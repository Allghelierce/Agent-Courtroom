// Shared contracts. Mirrors WORK_SPLIT.md; replace with an import from
// shared/schema.ts once Person C lands it.

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
  timestamp: string;
};

export type ChargeKind = "looping" | "overspending" | "stalling" | "flailing";

export type Charge = {
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

export type EvidencePacket = {
  charge: Charge;
  workerId: string;
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
  judgeModel: string;
  costUsd: number; // total court spend for this trial
  startedAt: string;
  finishedAt: string;
  mock: boolean; // true when no model was called
};
