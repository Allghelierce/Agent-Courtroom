import type { Charge, Event, Trial, Verdict } from "@court/types";
import demoStream from "@/data/stream-demo.json";
import demoTrials from "@/data/stream-trials.json";

// Mirrors the StreamMessage union in shared/schema.ts (origin/Amelia), which the engine's GET /stream sends.

export type WorkerState = "running" | "on_trial" | "awaiting_human" | "succeeded" | "halted" | "failed";

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
  summary?: string;
  seconds?: number;
};

export type Comparison = { withCourt: WorkerStatus; withoutCourt: WorkerStatus };

export type VerdictMessage = { workerId: string; chargeId: number; verdict: Verdict };

export type StreamMessage =
  | { type: "worker"; data: WorkerStatus }
  | { type: "event"; data: Event }
  | { type: "charge"; data: Charge }
  | { type: "verdict"; data: VerdictMessage }
  | { type: "comparison"; data: Comparison };

// The bundled demo (refreshed with `npm run sync-data`): the court's 4-worker stream, and a mock trial per charge.
export const DEMO_STREAM = demoStream as StreamMessage[];
export const DEMO_TRIALS = demoTrials as Trial[];

export function demoTrialId(workerId: string, chargeId: number): string {
  return `demo-${workerId}-${chargeId}`;
}

// Only events and a worker's start or end carry a time; every other message happens right after the one before.
function messageTime(msg: StreamMessage): number | undefined {
  if (msg.type === "event") return Date.parse(msg.data.timestamp);
  if (msg.type === "worker") {
    if (msg.data.endedAt) return Date.parse(msg.data.endedAt);
    if (msg.data.step === 0) return Date.parse(msg.data.startedAt);
  }
  return undefined;
}

// Milliseconds to wait before each message at 1x, so the replay keeps the run's real pacing.
export const DEMO_GAPS: number[] = (() => {
  let last: number | undefined;
  return DEMO_STREAM.map((msg) => {
    const t = messageTime(msg);
    const gap = t !== undefined && last !== undefined ? Math.max(0, t - last) : 0;
    if (t !== undefined) last = t;
    return gap;
  });
})();

// Every event in the demo, so the courtroom can show cited evidence even before the replay reaches it.
export const DEMO_EVENTS: Event[] = DEMO_STREAM.flatMap((m) => (m.type === "event" ? [m.data] : []));

// How each demo worker's run ended, for the courtroom's "after the verdict" panel.
export const DEMO_FINAL: Record<string, WorkerStatus> = Object.fromEntries(
  DEMO_STREAM.flatMap((m) => (m.type === "worker" && m.data.endedAt ? [[m.data.workerId, m.data]] : [])),
);
