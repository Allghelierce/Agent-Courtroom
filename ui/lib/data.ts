"use client";

import { useEffect, useState } from "react";
import type { Charge, ChargeKind, Event, Ruling, Trial, Verdict } from "@court/types";
import type { ComparisonResult, StreamMessage, WorkerStatus as EngineWorkerStatus } from "../../shared/schema";
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
export const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";

// The fixtures don't name their repos yet, so the dashboard labels them here.
const REPOS: Record<string, string> = {
  "worker-03": "rates-service",
  "worker-04": "invoice-parser",
  "worker-05": "todo-api",
  "worker-06": "search-indexer",
};

export type WorkerStatus = "working" | "on_trial" | "new_plan" | "needs_human" | "halted" | "succeeded" | "failed";

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
  costMode?: string;
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
  source: "live" | "demo" | "disconnected";
  loading: boolean;
  comparisons: ComparisonResult[];
};

// The engine replays durable history on connect. EventSource sends Last-Event-ID on reconnect.
export function useCourtData(): CourtData {
  const [state, setState] = useState<CourtData>(() => ({
    trials: DEMO_TRIALS,
    workers: buildWorkers(DEMO_RUNS, DEMO_TRIALS),
    source: "demo",
    loading: true,
    comparisons: [],
  }));

  useEffect(() => {
    const statuses = new Map<string, EngineWorkerStatus>();
    const events = new Map<number, Event>();
    const charges = new Map<string, Charge>();
    const trials = new Map<string, Trial>();
    const comparisons = new Map<string, ComparisonResult>();
    const stream = new EventSource(`${ENGINE_URL}/stream`);
    let connected = false;
    let lastSequence = 0;
    const render = () => {
      const list = [...trials.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const workers: WorkerView[] = [...statuses.values()].map((s) => {
        const mine = [...events.values()].filter((e) => e.workerId === s.workerId).sort((a, b) => a.step - b.step);
        const cases = list.filter((t) => t.workerId === s.workerId);
        const status: WorkerStatus = s.state === "running" ? "working" : s.state === "awaiting_human" ? "needs_human" : s.state;
        return { id: s.workerId, repo: s.task.includes("price") ? "price collector" : "checkout",
          events: mine, budgetUsd: s.budgetUsd, spendUsd: s.costUsd,
          testsPassing: s.testsPassing, testsTotal: s.testsTotal, trials: cases, status,
          lights: charges.has(s.workerId) ? [charges.get(s.workerId)!.kind] : [], costMode: s.costMode };
      });
      setState({ trials: list, workers, comparisons: [...comparisons.values()], source: "live", loading: false });
    };
    stream.onopen = () => {
      connected = true;
      render();
    };
    stream.onmessage = (event) => {
      let message: StreamMessage;
      try { message = JSON.parse(event.data) as StreamMessage; } catch { return; }
      if (message.sequence && message.sequence <= lastSequence) return;
      lastSequence = message.sequence ?? lastSequence;
      switch (message.type) {
        case "worker": statuses.set(message.data.workerId, message.data); break;
        case "event": events.set(message.data.id, message.data); break;
        case "charge": charges.set(message.data.workerId, message.data); break;
        case "trial": trials.set(message.data.id, message.data); break;
        case "verdict":
          if (["continue", "change_strategy"].includes(message.data.verdict.ruling)) charges.delete(message.data.workerId);
          break;
        case "comparison": comparisons.set(message.data.id, message.data); break;
      }
      render();
    };
    stream.onerror = () => setState((s) => ({ ...s, source: connected ? "disconnected" : "demo", loading: false }));
    return () => {
      stream.close();
    };
  }, []);

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
  succeeded: "Tests complete",
  failed: "Failed",
};

// Role colours carry meaning (ART.md): green healthy, red trouble, gold verdict, amber needs a human, soft stopped.
export const STATUS_COLOR: Record<WorkerStatus, string> = {
  working: "var(--green)",
  on_trial: "var(--red)",
  new_plan: "var(--gold)",
  needs_human: "var(--amber)",
  halted: "var(--soft)",
  succeeded: "var(--green)",
  failed: "var(--red)",
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
