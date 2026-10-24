// Shared contract between the engine (Person A) and the court + UI (Person B).
// The Python mirror lives in engine/courtroom_engine/schema.py. Change both together.

// --- Core types (from WORK_SPLIT.md) ---

export type Event = {
  id: number; // unique across all workers
  workerId: string;
  step: number; // per worker, starting at 1
  tool: "read_file" | "edit_file" | "run_tests" | "list_files" | string;
  args: Record<string, unknown>;
  tokens: number;
  costUsd: number; // cost of this step only
  testsPassing: number; // latest known count after this step
  testsTotal: number;
  error?: string;
  result?: string; // short summary of the tool output (added: monitors and lawyers need it)
  timestamp: string; // ISO 8601
};

export type ChargeKind = "looping" | "overspending" | "stalling" | "flailing";

export type Charge = {
  id: number; // added: lets verdicts point back at the charge they rule on
  workerId: string;
  kind: ChargeKind;
  summary: string;
  eventIds: number[];
};

export type Ruling = "continue" | "change_strategy" | "escalate" | "halt";

export type Verdict = {
  ruling: Ruling;
  instruction?: string; // required when ruling is change_strategy
  reasoning: string;
  cited_events: number[];
};

// --- convene(packet) -> Verdict ---
// The engine POSTs an EvidencePacket as JSON to the court URL and expects a Verdict back.

export type EvidencePacket = {
  charge: Charge;
  events: Event[]; // the last N events for this worker, oldest first
  testProgress: { step: number; testsPassing: number; testsTotal: number }[];
  spend: { costUsd: number; budgetUsd: number };
  task: string; // what the worker was asked to do
};

// --- Event stream (GET /stream, Server-Sent Events) ---
// Each SSE message is `data: <StreamMessage JSON>`. History is replayed on connect.

export type WorkerState =
  | "running"
  | "on_trial" // paused while the court deliberates
  | "awaiting_human" // ruling was escalate
  | "succeeded" // all tests passing
  | "halted" // ruling was halt
  | "failed"; // ran out of steps or budget, or the worker gave up

export type WorkerStatus = {
  workerId: string;
  state: WorkerState;
  task: string;
  courtEnabled: boolean;
  step: number;
  testsPassing: number;
  testsTotal: number;
  costUsd: number;
  budgetUsd: number;
  startedAt: string;
  endedAt?: string;
  summary?: string; // set when the run ends
  courtCostUsd?: number;
  courtCostComplete?: boolean;
  costMode?: "simulated" | "estimated_from_usage";
};

export type WorkerResult = WorkerStatus & {
  seconds: number;
  workerCostUsd: number;
  totalCostUsd: number | null;
  caseIds: string[];
  courtModes: string[];
  outcomeVerified: boolean;
};

export type ComparisonResult = {
  id: string;
  createdAt: string;
  task: string;
  brain: "scripted" | "claude";
  model: string;
  court: string;
  budgetUsd: number;
  maxSteps: number;
  costMode: "simulated" | "estimated_from_usage";
  successCriteria: string;
  withCourt: WorkerResult;
  withoutCourt: WorkerResult;
  savingsUsd: number | null;
  savingsPercent: number | null;
};

export type StreamMessage = (
  | { type: "worker"; data: WorkerStatus }
  | { type: "event"; data: Event }
  | { type: "charge"; data: Charge }
  | { type: "verdict"; data: { workerId: string; chargeId: number; verdict: Verdict; caseId?: string } }
  | { type: "trial"; data: import("../court/src/types").Trial }
  | { type: "comparison_error"; data: { error: string } }
  | { type: "comparison"; data: ComparisonResult }
) & { sequence?: number }; // durable SSE cursor; older JSONL fixtures omit it

// --- Human escalation (POST /workers/:workerId/resolve) ---
// Body is a Verdict chosen by the human; the waiting worker acts on it.
