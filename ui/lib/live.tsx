"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Charge, Event, Trial } from "@court/types";
import { COURT_URL, KIND_LABEL, RULING_LABEL, describeEvent, eventFailed } from "./data";
import { DEMO_GAPS, DEMO_STREAM, DEMO_TRIALS, demoTrialId, type Comparison, type StreamMessage, type VerdictMessage, type WorkerStatus } from "./stream";

// One live picture of every worker, built from StreamMessages. It comes from the engine's SSE stream when that's
// running, and from an in-browser replay of the bundled demo otherwise. It lives in the root layout, so the run
// keeps going while you watch a trial.

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? "http://localhost:8787/stream";

export type LiveWorker = { status: WorkerStatus; events: Event[]; charges: Charge[]; rulings: VerdictMessage[] };

export type FeedItem = {
  seq: number;
  at: string;
  workerId: string;
  tone: "event" | "fail" | "charge" | "verdict" | "done";
  text: string;
  charge?: { workerId: string; id: number };
};

type RunState = {
  workers: Record<string, LiveWorker>;
  order: string[];
  feed: FeedItem[];
  openCharges: Charge[];
  verdicts: VerdictMessage[];
  comparison?: Comparison;
  lastAt: string;
  seq: number;
};

const EMPTY: RunState = { workers: {}, order: [], feed: [], openCharges: [], verdicts: [], lastAt: "", seq: 0 };
const FEED_MAX = 200;

function apply(state: RunState, msg: StreamMessage | { type: "reset" }): RunState {
  if (msg.type === "reset") return EMPTY;
  const seq = state.seq + 1;
  const feed = (item: Omit<FeedItem, "seq" | "at">, at = state.lastAt) => [{ ...item, seq, at }, ...state.feed].slice(0, FEED_MAX);
  const worker = (id: string): LiveWorker =>
    state.workers[id] ?? {
      status: { workerId: id, state: "running", task: "", courtEnabled: true, step: 0, testsPassing: 0, testsTotal: 0, costUsd: 0, budgetUsd: 1, startedAt: state.lastAt },
      events: [],
      charges: [],
      rulings: [],
    };
  const put = (id: string, w: LiveWorker) => ({ workers: { ...state.workers, [id]: w }, order: state.order.includes(id) ? state.order : [...state.order, id] });

  switch (msg.type) {
    case "worker": {
      const d = msg.data;
      const w = worker(d.workerId);
      const ended = d.endedAt && !w.status.endedAt;
      return {
        ...state,
        ...put(d.workerId, { ...w, status: d }),
        seq,
        lastAt: d.endedAt ?? state.lastAt,
        feed: ended ? feed({ workerId: d.workerId, tone: d.state === "succeeded" ? "done" : "fail", text: d.summary ?? d.state }, d.endedAt) : state.feed,
      };
    }
    case "event": {
      const e = msg.data;
      const w = worker(e.workerId);
      return {
        ...state,
        ...put(e.workerId, { ...w, events: [...w.events, e] }),
        seq,
        lastAt: e.timestamp,
        feed: feed({ workerId: e.workerId, tone: eventFailed(e) ? "fail" : "event", text: `event ${e.id}: ${describeEvent(e)}` }, e.timestamp),
      };
    }
    case "charge": {
      const c = msg.data;
      const w = worker(c.workerId);
      return {
        ...state,
        ...put(c.workerId, { ...w, charges: [...w.charges, c] }),
        seq,
        openCharges: [...state.openCharges, c],
        feed: feed({ workerId: c.workerId, tone: "charge", text: `Monitor flagged ${KIND_LABEL[c.kind].toLowerCase()}. Court is in session.`, charge: { workerId: c.workerId, id: c.id ?? 0 } }),
      };
    }
    case "verdict": {
      const v = msg.data;
      const w = worker(v.workerId);
      return {
        ...state,
        ...put(v.workerId, { ...w, rulings: [...w.rulings, v] }),
        seq,
        openCharges: state.openCharges.filter((c) => !(c.workerId === v.workerId && c.id === v.chargeId)),
        verdicts: [...state.verdicts, v],
        feed: feed({ workerId: v.workerId, tone: "verdict", text: `The court ruled: ${RULING_LABEL[v.verdict.ruling].toLowerCase()}.`, charge: { workerId: v.workerId, id: v.chargeId } }),
      };
    }
    case "comparison":
      return { ...state, seq, comparison: msg.data };
  }
}

// ---------- court server cases ----------

function useCourtCases(): Trial[] {
  const [cases, setCases] = useState<Trial[]>([]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let up = false;
      try {
        const res = await fetch(`${COURT_URL}/cases`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const body = (await res.json()) as Trial[];
          up = true;
          if (alive && Array.isArray(body)) setCases(body);
        }
      } catch {
        // offline: fall back to the bundled demo trials
      }
      // Poll often while the court is up; back off while it's down so the console stays quiet.
      if (alive) timer = setTimeout(load, up ? 4000 : 20000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return cases;
}

// ---------- the provider ----------

export type Source = "connecting" | "live" | "replay";

type LiveValue = RunState & {
  source: Source;
  courtUp: boolean;
  playing: boolean;
  speed: number;
  progress: number; // 0..1 through the demo replay
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  restart: () => void;
  trialFor: (workerId: string, chargeId: number) => Trial | undefined;
  runTrials: Trial[]; // trials for the verdicts seen in this run, oldest first
  caseLog: Trial[]; // every trial to list in the case log, oldest first
};

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(apply, EMPTY);
  const [source, setSource] = useState<Source>("connecting");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [index, setIndex] = useState(0);
  const courtCases = useCourtCases();

  // Try the engine's stream first; fall back to the bundled replay if it isn't up.
  useEffect(() => {
    const es = new EventSource(STREAM_URL);
    let opened = false;
    const fallback = () => {
      if (opened) return;
      es.close();
      setSource("replay");
    };
    const timer = setTimeout(fallback, 1500);
    es.onopen = () => {
      opened = true;
      clearTimeout(timer);
      dispatch({ type: "reset" }); // the server replays history on every connect
      setSource("live");
    };
    es.onmessage = (e) => {
      try {
        dispatch(JSON.parse(e.data) as StreamMessage);
      } catch {
        // ignore a malformed line
      }
    };
    es.onerror = fallback;
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);

  // The in-browser replay, paced like the original run.
  useEffect(() => {
    if (source !== "replay" || !playing || index >= DEMO_STREAM.length) return;
    const timer = setTimeout(() => {
      dispatch(DEMO_STREAM[index]);
      setIndex(index + 1);
    }, Math.min(DEMO_GAPS[index], 10000) / speed);
    return () => clearTimeout(timer);
  }, [source, playing, index, speed]);

  const restart = useCallback(() => {
    dispatch({ type: "reset" });
    setIndex(0);
    setPlaying(true);
  }, []);

  const value = useMemo<LiveValue>(() => {
    const trialFor = (workerId: string, chargeId: number) =>
      courtCases.find((t) => t.workerId === workerId && t.charge.id === chargeId) ?? DEMO_TRIALS.find((t) => t.id === demoTrialId(workerId, chargeId));
    return {
      ...state,
      source,
      courtUp: courtCases.length > 0,
      playing,
      speed,
      progress: index / DEMO_STREAM.length,
      setPlaying,
      setSpeed,
      restart,
      trialFor,
      runTrials: state.verdicts.flatMap((v) => trialFor(v.workerId, v.chargeId) ?? []),
      caseLog: courtCases.length > 0 ? courtCases : DEMO_TRIALS,
    };
  }, [state, source, courtCases, playing, speed, index, restart]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside <LiveProvider>");
  return value;
}
