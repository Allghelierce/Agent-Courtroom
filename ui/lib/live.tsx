"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Charge, Event, Trial } from "@court/types";
import { COURT_URL, ENGINE_URL, KIND_LABEL, RULING_LABEL, describeEvent, eventFailed, isClaudeSession } from "./data";
import { DEMO_GAPS, DEMO_STREAM, DEMO_TRIALS, demoTrialId, type ComparisonResult, type StreamMessage, type VerdictMessage, type WorkerStatus } from "./stream";

// One live picture of every worker, built from StreamMessages (shared/schema.ts). It comes from the engine's SSE
// stream when that's running, and from an in-browser replay of the bundled demo otherwise. It lives in the root
// layout, so the run keeps going while you watch a trial.

export type LiveWorker = { status: WorkerStatus; events: Event[]; charges: Charge[]; rulings: VerdictMessage[] };

export type FeedItem = {
  seq: number;
  at: string;
  workerId: string;
  tone: "start" | "event" | "fail" | "charge" | "verdict" | "done";
  text: string;
  charge?: { workerId: string; id: number };
};

type RunState = {
  workers: Record<string, LiveWorker>;
  order: string[];
  feed: FeedItem[];
  openCharges: Charge[];
  verdicts: VerdictMessage[];
  trials: Record<string, Trial>; // full trials the engine streamed
  comparison?: ComparisonResult;
  comparisonError?: string;
  lastAt: string;
  lastSequence: number; // the engine's durable cursor; a reconnect replays history, so older messages are skipped
  seq: number;
};

const EMPTY: RunState = { workers: {}, order: [], feed: [], openCharges: [], verdicts: [], trials: {}, lastAt: "", lastSequence: 0, seq: 0 };
const FEED_MAX = 200;
const RETRY_MS = 5000; // while the engine's stream is down, look for it this often

function apply(state: RunState, msg: StreamMessage | { type: "reset" }): RunState {
  if (msg.type === "reset") return EMPTY;
  if (msg.sequence !== undefined && msg.sequence <= state.lastSequence) return state;
  const base = { ...state, seq: state.seq + 1, lastSequence: msg.sequence ?? state.lastSequence };
  const seq = base.seq;
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
      const started = !state.workers[d.workerId] && !d.endedAt;
      const ended = d.endedAt && !w.status.endedAt;
      const startText = `${isClaudeSession(d.workerId) ? "Session connected" : "Started"}${d.task ? `: ${d.task}` : ""}`;
      return {
        ...base,
        ...put(d.workerId, { ...w, status: d }),
        // A finished worker has no trial left to wait for.
        openCharges: ended ? state.openCharges.filter((c) => c.workerId !== d.workerId) : state.openCharges,
        lastAt: d.endedAt ?? state.lastAt,
        feed: ended
          ? feed({ workerId: d.workerId, tone: d.state === "succeeded" ? "done" : "fail", text: d.summary ?? d.state }, d.endedAt)
          : started
            ? feed({ workerId: d.workerId, tone: "start", text: startText }, d.startedAt)
            : state.feed,
      };
    }
    case "event": {
      const e = msg.data;
      const w = worker(e.workerId);
      return {
        ...base,
        ...put(e.workerId, { ...w, events: [...w.events, e] }),
        lastAt: e.timestamp,
        feed: feed({ workerId: e.workerId, tone: eventFailed(e) ? "fail" : "event", text: `event ${e.id}: ${describeEvent(e)}` }, e.timestamp),
      };
    }
    case "charge": {
      const c = msg.data;
      const w = worker(c.workerId);
      // Without a court (the comparison's unsupervised run) the warning light flashes and nobody acts.
      const court = w.status.courtEnabled !== false;
      const flagged = `Monitor flagged ${KIND_LABEL[c.kind].toLowerCase()}.`;
      return {
        ...base,
        ...put(c.workerId, { ...w, charges: [...w.charges, c] }),
        openCharges: court ? [...state.openCharges, c] : state.openCharges,
        feed: feed({ workerId: c.workerId, tone: "charge", text: court ? `${flagged} Court is in session.` : `${flagged} No court on this run, so it keeps going.`, charge: { workerId: c.workerId, id: c.id ?? 0 } }),
      };
    }
    case "verdict": {
      const v = msg.data;
      const w = worker(v.workerId);
      return {
        ...base,
        ...put(v.workerId, { ...w, rulings: [...w.rulings, v] }),
        openCharges: state.openCharges.filter((c) => !(c.workerId === v.workerId && c.id === v.chargeId)),
        verdicts: [...state.verdicts, v],
        feed: feed({ workerId: v.workerId, tone: "verdict", text: `The court ruled: ${RULING_LABEL[v.verdict.ruling].toLowerCase()}.`, charge: { workerId: v.workerId, id: v.chargeId } }),
      };
    }
    case "trial":
      return { ...base, trials: { ...state.trials, [msg.data.id]: msg.data } };
    case "comparison":
      return { ...base, comparison: msg.data, comparisonError: undefined };
    case "comparison_error":
      return { ...base, comparisonError: msg.data.error };
    default:
      return base; // usage and anything newer: nothing to show yet
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
        // offline: the engine's streamed trials or the bundled demo stand in
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

export type Source = "connecting" | "live" | "disconnected" | "replay";

type LiveValue = RunState & {
  source: Source;
  courtUp: boolean;
  simulatedCosts: boolean; // a scripted run: worker spend is simulated, not billed
  playing: boolean;
  speed: number;
  progress: number; // 0..1 through the demo replay
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  restart: () => void;
  demoChosen: boolean; // the viewer switched to the recorded demo while the engine may be up
  playDemo: () => void; // show the recorded run even though the engine is up
  goLive: () => void; // back to the engine's stream
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
  const [demoChosen, setDemoChosen] = useState(false);
  const courtCases = useCourtCases();

  // Try the engine's stream first; fall back to the bundled replay if it isn't up, and keep looking for it: the Claude
  // Code plugin only starts its daemon when a session does, often after this page has loaded. A viewer who picks the
  // recorded demo skips the engine entirely until they go back to it.
  useEffect(() => {
    if (demoChosen) return;
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const connect = () => {
      const current = new EventSource(`${ENGINE_URL}/stream`);
      es = current;
      const retry = () => {
        clearTimeout(timer);
        current.close();
        if (!opened) setSource("replay"); // once live, keep showing the last data received
        timer = setTimeout(connect, RETRY_MS);
      };
      timer = setTimeout(retry, 1500);
      current.onopen = () => {
        // Every connection is fresh, so the engine replays its whole history: rebuild from it. That drops the demo
        // replay, and copes with an engine restarted with its history wiped (sequence numbers from 1 again).
        dispatch({ type: "reset" });
        opened = true;
        clearTimeout(timer);
        setSource("live");
      };
      current.onmessage = (e) => {
        try {
          dispatch(JSON.parse(e.data) as StreamMessage);
        } catch {
          // ignore a malformed line
        }
      };
      current.onerror = () => {
        if (opened) setSource("disconnected"); // keep showing the last data received until it's back
        retry(); // reconnect fresh rather than let the browser resume from an event id the engine may not have
      };
    };
    connect();
    return () => {
      clearTimeout(timer);
      es?.close();
    };
  }, [demoChosen]);

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

  const playDemo = useCallback(() => {
    dispatch({ type: "reset" });
    setIndex(0);
    setPlaying(true);
    setDemoChosen(true);
    setSource("replay");
  }, []);

  const goLive = useCallback(() => {
    dispatch({ type: "reset" });
    setSource("connecting");
    setDemoChosen(false);
  }, []);

  const value = useMemo<LiveValue>(() => {
    const streamed = Object.values(state.trials);
    // A verdict names its case when the engine knows it; otherwise match on worker and charge.
    const trialFor = (workerId: string, chargeId: number) => {
      const caseId = state.verdicts.find((v) => v.workerId === workerId && v.chargeId === chargeId)?.caseId;
      const match = (t: Trial) => (caseId ? t.id === caseId : t.workerId === workerId && t.charge.id === chargeId);
      return streamed.find(match) ?? courtCases.find(match) ?? DEMO_TRIALS.find((t) => t.id === demoTrialId(workerId, chargeId));
    };
    const known = new Map<string, Trial>();
    for (const t of [...courtCases, ...streamed]) known.set(t.id, t);
    return {
      ...state,
      source,
      courtUp: courtCases.length > 0,
      simulatedCosts: Object.values(state.workers).some((w) => w.status.costMode === "simulated"),
      playing,
      speed,
      progress: index / DEMO_STREAM.length,
      setPlaying,
      setSpeed,
      restart,
      demoChosen,
      playDemo,
      goLive,
      trialFor,
      runTrials: state.verdicts.flatMap((v) => trialFor(v.workerId, v.chargeId) ?? []),
      caseLog: known.size > 0 ? [...known.values()].toSorted((a, b) => a.startedAt.localeCompare(b.startedAt)) : DEMO_TRIALS,
    };
  }, [state, source, courtCases, playing, speed, index, restart, demoChosen, playDemo, goLive]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside <LiveProvider>");
  return value;
}
