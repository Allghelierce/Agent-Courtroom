"use client";

import { useMemo } from "react";
import type { Event, Trial } from "@court/types";
import { useLive } from "./live";
import { DEMO_EVENTS, DEMO_FINAL, type WorkerStatus } from "./stream";

// What a case page needs beyond the trial itself: the worker's events by id, and how its run ended.
// Demo cases read the bundled demo too, so cited evidence resolves before the replay reaches it.
export function useCaseContext(trial: Trial): { events: Map<number, Event>; outcome?: WorkerStatus } {
  const live = useLive();
  const worker = live.workers[trial.workerId];
  const demo = trial.id.startsWith("demo-");

  const events = useMemo(() => {
    const byId = new Map<number, Event>();
    if (demo) for (const e of DEMO_EVENTS) if (e.workerId === trial.workerId) byId.set(e.id, e);
    for (const e of worker?.events ?? []) byId.set(e.id, e);
    return byId;
  }, [demo, trial.workerId, worker?.events]);

  const outcome = worker?.status.endedAt ? worker.status : demo ? DEMO_FINAL[trial.workerId] : undefined;
  return { events, outcome };
}
