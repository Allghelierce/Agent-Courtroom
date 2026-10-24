"use client";

import { useEffect, useState } from "react";
import type { Charge, ChargeKind, Event, Ruling, Trial, Verdict } from "@court/types";
import loopingRun from "@/data/runs/looping-run.json";
import stallingRun from "@/data/runs/stalling-run.json";
import overspendRun from "@/data/runs/overspend-run.json";
import falseAlarmRun from "@/data/runs/false-alarm-run.json";
import loopingCase from "@/data/cases/looping.json";
import stallingCase from "@/data/cases/stalling.json";
import overspendCase from "@/data/cases/overspend.json";
import falseAlarmCase from "@/data/cases/false-alarm.json";

export type { Charge, ChargeKind, Event, Ruling, Trial, Verdict };

// A worker's run as the engine logs it. Bundled fixtures (refreshed with `npm run sync-data`) stand in
// until Person C's event server streams live runs.
export type Run = { budgetUsd: number; events: Event[]; charge?: Charge; verdict?: Verdict };

const DEMO_RUNS = [loopingRun, stallingRun, overspendRun, falseAlarmRun] as Run[];
const DEMO_TRIALS = ([loopingCase, stallingCase, overspendCase, falseAlarmCase] as Trial[]).toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));

export const COURT_URL = process.env.NEXT_PUBLIC_COURT_URL ?? "http://localhost:4100";

// The fixtures don't name their repos yet, so the dashboard labels them here.
const REPOS: Record<string, string> = {
  "worker-03": "rates-service",
  "worker-04": "invoice-parser",
  "worker-05": "todo-api",
  "worker-06": "search-indexer",
};

export type WorkerStatus = "working" | "on_trial" | "new_plan" | "needs_human" | "halted";

export type WorkerView = {
  id: string;
  repo: string;
  events: Event[];
  budgetUsd: number;
  spendUsd: number;
  testsPassing: number;
  testsTotal: number;
  trials: Trial[]; // oldest first
  status: WorkerStatus;
  lights: ChargeKind[]; // monitors that fired and haven't been cleared by a "continue" ruling
};

const STATUS_BY_RULING: Record<Ruling, WorkerStatus> = {
  continue: "working",
  change_strategy: "new_plan",
  escalate: "needs_human",
  halt: "halted",
};

export function buildWorkers(runs: Run[], trials: Trial[]): WorkerView[] {
  return runs.map((run) => {
    const id = run.events[0]?.workerId ?? "worker";
    const last = run.events.at(-1);
    const mine = trials.filter((t) => t.workerId === id);
    const latest = mine.at(-1);
    const openCharge = !latest && run.charge;
    return {
      id,
      repo: REPOS[id] ?? "repo",
      events: run.events,
      budgetUsd: run.budgetUsd,
      spendUsd: run.events.reduce((sum, e) => sum + e.costUsd, 0),
      testsPassing: last?.testsPassing ?? 0,
      testsTotal: last?.testsTotal ?? 0,
      trials: mine,
      status: latest ? STATUS_BY_RULING[latest.verdict.ruling] : openCharge ? "on_trial" : "working",
      lights: latest && latest.verdict.ruling !== "continue" ? [latest.charge.kind] : openCharge ? [openCharge.kind] : [],
    };
  });
}

export type CourtData = {
  trials: Trial[];
  workers: WorkerView[];
  source: "live" | "demo";
  loading: boolean;
};

async function fetchTrials(): Promise<Trial[] | null> {
  try {
    const res = await fetch(`${COURT_URL}/cases`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as Trial[];
    return Array.isArray(body) && body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

// Uses the live court server when it's up and has cases, and the bundled demo cases otherwise.
// Polls so a trial convened during the demo shows up without a reload.
export function useCourtData(pollMs = 4000): CourtData {
  const [state, setState] = useState<CourtData>(() => ({
    trials: DEMO_TRIALS,
    workers: buildWorkers(DEMO_RUNS, DEMO_TRIALS),
    source: "demo",
    loading: true,
  }));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const live = await fetchTrials();
      if (!alive) return;
      const trials = live ?? DEMO_TRIALS;
      setState({ trials, workers: buildWorkers(DEMO_RUNS, trials), source: live ? "live" : "demo", loading: false });
    };
    load();
    const timer = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pollMs]);

  return state;
}

export function runFor(workerId: string): Run | undefined {
  return DEMO_RUNS.find((r) => r.events[0]?.workerId === workerId);
}

export function repoFor(workerId: string): string {
  return REPOS[workerId] ?? "repo";
}

// ---------- labels and formatting ----------

export const KIND_LABEL: Record<ChargeKind, string> = {
  looping: "Looping",
  stalling: "Stuck",
  overspending: "Overspending",
  flailing: "Flailing",
};

export const RULING_LABEL: Record<Ruling, string> = {
  continue: "Keep going",
  change_strategy: "Change strategy",
  escalate: "Ask a human",
  halt: "Halt",
};

export const STATUS_LABEL: Record<WorkerStatus, string> = {
  working: "Working",
  on_trial: "On trial",
  new_plan: "New plan",
  needs_human: "Needs a human",
  halted: "Halted",
};

// Role colours carry meaning (ART.md): green healthy, red trouble, gold verdict, amber needs a human, soft stopped.
export const STATUS_COLOR: Record<WorkerStatus, string> = {
  working: "var(--green)",
  on_trial: "var(--red)",
  new_plan: "var(--gold)",
  needs_human: "var(--amber)",
  halted: "var(--soft)",
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
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function describeEvent(e: Event): string {
  const path = typeof e.args.path === "string" ? e.args.path : "";
  if (e.tool === "run_tests") return e.result ? `Ran the tests: ${e.result}` : "Ran the tests";
  if (e.tool === "read_file") return `Read ${path}`;
  if (e.tool === "edit_file") return `Edited ${path}`;
  return e.result ? `${e.tool}: ${e.result}` : e.tool;
}

// The engine reports test failures in a run_tests result and tool failures in `error`.
export function eventFailed(e: Event): boolean {
  return Boolean(e.error) || (e.tool === "run_tests" && e.testsPassing < e.testsTotal);
}
