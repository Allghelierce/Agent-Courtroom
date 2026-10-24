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
  workerStartedAt?: string; // optional: when this worker's run began (WorkerStatus.startedAt)
};

// The court's enriched packet, built from an EnginePacket or a raw event log.
export type EvidencePacket = {
  charge: Charge;
  workerId: string;
  task?: string;
  // Earliest time this run is known to have been going: the run's start if known, else the
  // oldest event in the packet. Worker IDs repeat across engine runs, so the summary rules
  // only count earlier trials that finished after this.
  runSince?: string;
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
  costComplete?: boolean;
  usage?: Record<string, unknown>;
};

export type Trial = {
  id: string;
  workerId: string;
  charge: Charge;
  prosecution: Argument;
  defense: Argument;
  verdict: Verdict;
  precedents?: string[]; // ids of earlier trials shown to the Judge
  summary?: "repeat_offender" | "court_budget"; // decided by court/src/rules.ts without a trial
  priorCaseIds?: string[]; // for a summary ruling: the earlier cases it rests on
  runSince?: string; // the packet's runSince, kept so later trials can tell runs apart
  judgeModel: string;
  costUsd: number; // total court spend for this trial
  costComplete?: boolean;
  judgeUsage?: Record<string, unknown>;
  pricingDate?: string;
  startedAt: string;
  finishedAt: string;
  mock: boolean; // true when no model was called
};
