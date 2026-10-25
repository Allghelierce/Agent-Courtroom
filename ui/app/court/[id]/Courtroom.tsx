"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CourtScene } from "@/components/CourtScene";
import { PixelIcon, RulingTag, StatusTag } from "@/components/Pieces";
import { Portrait } from "@/components/Sprites";
import { CHARGE_PHRASE, COURT_URL, ENGINE_URL, RECORDED_DEMO, RULING_COLOR, RULING_LABEL, describeEvent, eventFailed, usd, type Event, type Trial } from "@/lib/data";
import { useLive } from "@/lib/live";
import { buildScript, type Line } from "@/lib/script";
import { blip, gavel, objection, setSoundEnabled } from "@/lib/sound";
import { CAST } from "@/lib/sprites";
import { useCaseContext } from "@/lib/case";
import { DEMO_TRIALS, type WorkerStatus } from "@/lib/stream";
import { CaseRecord } from "./CaseRecord";

const AUTO_DELAY_MS = 2600;
const CUT_IN_MS = 1300;
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SOUND_KEY = "courtroom-sound";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

export function Courtroom() {
  const { id } = useParams<{ id: string }>();
  const view = useSearchParams().get("view") === "record" ? "record" : "replay";
  const live = useLive();
  const [lookup, setLookup] = useState<{ id: string; trial: Trial | null } | null>(null);
  const known = live.caseLog.find((t) => t.id === id) ?? live.runTrials.find((t) => t.id === id) ?? DEMO_TRIALS.find((t) => t.id === id);
  const trial = known ?? (lookup?.id === id ? lookup.trial : undefined);

  // A case that isn't in the list yet (just convened) can still be opened directly: ask the court, then the engine.
  useEffect(() => {
    if (known) return;
    if (RECORDED_DEMO) {
      setLookup({ id, trial: null });
      return;
    }
    const get = (base: string) =>
      fetch(`${base}/cases/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2000) })
        .then((r) => (r.ok ? (r.json() as Promise<Trial>) : null))
        .catch(() => null);
    get(COURT_URL)
      .then((t) => t ?? get(ENGINE_URL))
      .then((t) => setLookup({ id, trial: t }));
  }, [id, known]);

  if (!trial) {
    const loading = trial === undefined;
    return (
      <div className="px-box flex flex-col items-start gap-4 p-6">
        <h1 className="text-[28px]">{loading ? "Calling the court to order..." : "No case with that number"}</h1>
        {!loading && <p className="m-0">Case {id} isn&apos;t in the case log. Pick a trial from the list to watch it.</p>}
        <Link href="/cases" className="px-btn">Open the case log</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/cases" className="text-sm text-soft">Back to the case log</Link>
          <h1 className="text-[28px]">
            {trial.workerId} is charged with {CHARGE_PHRASE[trial.charge.kind]}
          </h1>
          <span className="text-sm text-soft">Case {trial.id}</span>
        </div>
        {/* The courtroom is the case; the record is the same case as a plain audit, for anyone checking the work. */}
        <nav className="flex gap-3" aria-label="Case views">
          {(["replay", "record"] as const).map((v) => (
            <Link
              key={v}
              href={v === "record" ? `/court/${trial.id}?view=record` : `/court/${trial.id}`}
              aria-current={view === v ? "page" : undefined}
              className={`px-btn ${view === v ? "" : "ghost"}`}
            >
              <PixelIcon name={v === "replay" ? "gavel" : "scroll"} />
              {v === "replay" ? "Courtroom" : "Record"}
            </Link>
          ))}
        </nav>
      </div>
      {view === "record" ? <CaseRecord key={trial.id} trial={trial} /> : trial.summary ? <SummaryJudgment trial={trial} /> : <TrialView key={trial.id} trial={trial} />}
    </div>
  );
}

function TrialView({ trial }: { trial: Trial }) {
  const { events, outcome } = useCaseContext(trial);
  const script = useMemo(() => buildScript(trial, outcome), [trial, outcome]);
  const [idx, setIdx] = useState(0);
  // How much of which line has been typed; a new line starts at 0 without resetting state in an effect.
  const [typed, setTyped] = useState({ idx: 0, n: 0 });
  const [auto, setAuto] = useState(true);
  const [sound, setSound] = useState(false);
  const still = useReducedMotion();
  const line = script[idx];
  const shown = still ? line.text.length : typed.idx === idx ? typed.n : 0;
  const done = shown >= line.text.length;
  const reachedVerdict = script.slice(0, idx + 1).some((l) => l.verdict);
  const last = idx === script.length - 1;
  const cutIn = !still && Boolean(line.burst || line.verdict);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(SOUND_KEY) === "on";
    } catch {
      // storage blocked: sound stays off
    }
    if (saved) {
      setSoundEnabled(true);
      setSound(true); // eslint-disable-line react-hooks/set-state-in-effect -- reading the viewer's saved choice once on mount
    }
  }, []);

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    setSoundEnabled(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // storage blocked: the choice lasts for this visit
    }
  };

  // Each line's big moment: the objection sting or the gavel.
  useEffect(() => {
    if (line.burst) objection();
    if (line.verdict) gavel();
  }, [line]);

  // Type the line out two characters per frame, after the cut-in if there is one.
  useEffect(() => {
    if (still) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(
      () => {
        timer = setInterval(() => {
          setTyped((t) => {
            const n = t.idx === idx ? t.n : 0;
            if (n >= line.text.length) {
              clearInterval(timer);
              return t;
            }
            return { idx, n: n + 2 };
          });
          blip(line.who);
        }, 33);
      },
      cutIn ? CUT_IN_MS - 300 : 0,
    );
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [idx, line, still, cutIn]);

  const advance = useCallback(() => {
    if (!done) setTyped({ idx, n: line.text.length });
    else if (!last) setIdx((i) => i + 1);
  }, [done, last, line, idx]);

  useEffect(() => {
    if (!auto || !done || last) return;
    const timer = setTimeout(() => setIdx((i) => i + 1), AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [auto, done, last, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, textarea")) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, idx]);

  const cast = line.who === "clerk" ? CAST.clerk : CAST[line.who];
  const name = line.who === "worker" ? trial.workerId.toUpperCase() : cast.name;
  const evidence = (line.cites ?? []).flatMap((n) => events.get(n) ?? []);

  return (
    <div className="flex flex-col gap-6">
      <div key={cutIn ? idx : "stage"} className={`relative overflow-hidden border-4 border-edge bg-[#2a1d4a] ${cutIn ? "shake" : ""}`} style={{ boxShadow: "4px 4px 0 var(--shadow)" }}>
        <button type="button" onClick={advance} aria-label="Next line" className="block w-full cursor-pointer border-0 bg-transparent p-0">
          <CourtScene
            speaker={line.who}
            moods={{ ...line.moods, [line.who]: line.mood }}
            swirl={trial.charge.kind === "looping" && !reachedVerdict}
            gavelDown={line.verdict}
            workerLabel={trial.workerId}
          />
        </button>

        {evidence.length > 0 && <SceneEvidence key={idx} events={evidence.slice(-3)} />}
        {line.burst && still && <div className={`burst show ${line.burst.tone}`} aria-hidden>{line.burst.text}</div>}
        {cutIn && <CutIn line={line} />}
        {line.verdict && cutIn && <div key={`flash-${idx}`} className="flash late pointer-events-none absolute inset-0" aria-hidden />}
        {line.verdict && <VerdictStamp trial={trial} late={cutIn} />}
        {idx === 0 && !still && <Curtain />}

        {/* The dialogue box sits over the floor on wide screens, visual-novel style, and below the scene on phones. */}
        <div className="vn border-t-4 border-edge bg-panel lg:absolute lg:inset-x-0 lg:bottom-4 lg:mx-auto lg:max-w-[960px] lg:border-4 lg:shadow-[4px_4px_0_var(--shadow)]" aria-live="polite">
          <div className="flex gap-4 p-3">
            <div className={`hidden shrink-0 self-start border-4 border-edge sm:block ${done ? "" : "talk"}`}>
              <Portrait who={line.who} mood={line.mood} scale={2} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span key={idx} className="px-tag tag-in self-start" style={{ background: cast.tag, color: "var(--on-accent)" }}>{name}</span>
              <p className="m-0 min-h-[4em] text-[20px] leading-snug">{line.text.slice(0, shown)}</p>
              <span className={`self-end font-display text-sm ${done && !last ? "blink" : "invisible"}`} aria-hidden>▼</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="px-btn ghost" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>Previous line</button>
        <button type="button" className="px-btn" onClick={advance} disabled={done && last}>{done ? "Next line" : "Show the whole line"}</button>
        <button type="button" className="px-btn ghost" aria-pressed={auto} onClick={() => setAuto(!auto)}>Auto-play {auto ? "on" : "off"}</button>
        <button type="button" className="px-btn ghost" aria-pressed={sound} onClick={toggleSound}>Sound {sound ? "on" : "off"}</button>
        {last && done && <button type="button" className="px-btn ghost" onClick={() => setIdx(0)}>Replay the trial</button>}
        <span className="ml-auto text-sm text-soft">Line {idx + 1} of {script.length}. Space or click for the next line.</span>
      </div>

      {reachedVerdict && <AfterVerdict trial={trial} outcome={outcome} events={events} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="px-box flex flex-col gap-3 p-4" aria-labelledby="evidence-h">
          <h2 id="evidence-h" className="text-[20px]">Evidence</h2>
          {evidence.length === 0 ? (
            <p className="m-0 text-sm text-soft">{line.cites?.length ? `Cites ${line.cites.map((n) => `event ${n}`).join(", ")}.` : "No events cited in this line."}</p>
          ) : (
            <ul key={idx} className="m-0 flex list-none flex-col gap-2 p-0">
              {evidence.map((e, i) => (
                <EventCard key={e.id} event={e} delay={i * 80} />
              ))}
            </ul>
          )}
        </section>

        <section className="px-box flex flex-col gap-3 p-4" aria-labelledby="facts-h">
          <h2 id="facts-h" className="text-[20px]">The case</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-soft">Charge</dt>
            <dd className="m-0">{trial.charge.summary}</dd>
            <dt className="text-soft">Ruling</dt>
            <dd className="m-0">{reachedVerdict ? <RulingTag ruling={trial.verdict.ruling} /> : "Waiting for the Judge"}</dd>
            <dt className="text-soft">Court cost</dt>
            <dd className="m-0">{usd(trial.costUsd)}{trial.mock ? " (mock run, no model calls)" : ""}</dd>
            <dt className="text-soft">Models</dt>
            <dd className="m-0">Prosecution {trial.prosecution.model}, defense {trial.defense.model}, judge {trial.judgeModel}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

function EventCard({ event: e, delay }: { event: Event; delay?: number }) {
  return (
    <li className={`px-inset flex flex-col gap-1 p-3 text-sm ${delay === undefined ? "" : "pop"}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className="flex justify-between gap-2">
        <span className="font-display">event {e.id}</span>
        <span>{e.testsPassing}/{e.testsTotal} tests · {usd(e.costUsd)}</span>
      </div>
      <span style={eventFailed(e) ? { color: "#ff8a9a" } : undefined}>{describeEvent(e)}</span>
      {e.error && <span style={{ color: "#ff8a9a" }}>{e.error}</span>}
    </li>
  );
}

// The cited events, pinned to the courtroom wall while a line is spoken.
function SceneEvidence({ events }: { events: Event[] }) {
  return (
    <ul className="vn pointer-events-none absolute left-4 top-4 m-0 hidden w-[300px] list-none flex-col gap-2 p-0 lg:flex" aria-hidden>
      {events.map((e, i) => (
        <li key={e.id} className="pop border-4 border-shadow bg-panel px-3 py-2 text-sm shadow-[4px_4px_0_var(--shadow)]" style={{ animationDelay: `${i * 120}ms` }}>
          <div className="flex justify-between gap-2">
            <span className="font-display" style={{ color: "var(--gold)" }}>Evidence: event {e.id}</span>
            <span>{e.testsPassing}/{e.testsTotal}</span>
          </div>
          <span className="line-clamp-1" style={eventFailed(e) ? { color: "#ff8a9a" } : undefined}>{describeEvent(e)}</span>
        </li>
      ))}
    </ul>
  );
}

// The anime cut-in: a speed-lined band with a close-up of whoever is about to make a big point.
function CutIn({ line }: { line: Line }) {
  const color = line.burst?.tone === "blue" ? "#2f8fe0" : line.burst ? "var(--red)" : "var(--gold)";
  const text = line.burst?.text ?? "Order in the court!";
  return (
    <div className="cutin pointer-events-none absolute inset-x-0 top-[18%] flex h-[46%] items-center gap-6 overflow-hidden border-y-4 border-shadow px-[6%]" style={{ background: color }} aria-hidden>
      <div className="cutin-lines absolute inset-0" />
      <div className="relative shrink-0 border-4 border-shadow">
        <Portrait who={line.who} mood={line.mood} scale={5} />
      </div>
      <span className="relative font-display text-[clamp(32px,6vw,72px)] leading-none text-white" style={{ textShadow: "4px 4px 0 #000" }}>
        {text}
      </span>
    </div>
  );
}

// The opening: "All rise" on a closed curtain, which parts onto the courtroom.
function Curtain() {
  return (
    <div className="curtain pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      <div className="half l" />
      <div className="half r" />
      <div className="call absolute inset-0 flex items-center justify-center">
        <span className="border-4 border-shadow bg-gold px-5 py-3 font-display text-[clamp(24px,4vw,44px)] leading-none text-[var(--on-accent)] shadow-[4px_4px_0_var(--shadow)]">All rise</span>
      </div>
    </div>
  );
}

function VerdictStamp({ trial, late = false }: { trial: Trial; late?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-4">
      <div className={`stamp border-4 border-shadow px-5 py-3 text-center ${late ? "late" : ""}`} style={{ background: RULING_COLOR[trial.verdict.ruling], color: "var(--on-accent)", boxShadow: "4px 4px 0 var(--shadow)" }}>
        <div className="font-display text-sm">Verdict</div>
        <div className="font-display text-[28px] leading-none sm:text-[40px]">{RULING_LABEL[trial.verdict.ruling]}</div>
      </div>
    </div>
  );
}

export const SUMMARY_REASON: Record<NonNullable<Trial["summary"]>, string> = {
  repeat_offender: "This worker has been charged before, so the court ruled on its record without hearing the case again.",
  court_budget: "The court is over its own budget, so it ruled without paying for a trial.",
};

// Some charges are decided without a trial (court/src/rules.ts): a short card instead of the courtroom dialogue.
function SummaryJudgment({ trial }: { trial: Trial }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="px-box flex flex-wrap items-start gap-6 p-6">
        <div className="shrink-0 border-4 border-edge">
          <Portrait who="judge" mood="neutral" scale={3} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="px-tag self-start" style={{ background: "var(--gold)", color: "var(--on-accent)" }}>Summary judgment</span>
          <h2 className="text-[28px]">{RULING_LABEL[trial.verdict.ruling]}, no trial needed</h2>
          <p className="m-0 text-[20px] leading-snug">{trial.summary ? SUMMARY_REASON[trial.summary] : ""}</p>
          <p className="m-0">{trial.verdict.reasoning}</p>
          {trial.priorCaseIds && trial.priorCaseIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span>Rests on</span>
              {trial.priorCaseIds.map((id) => (
                <Link key={id} href={`/court/${id}`} className="px-btn ghost">
                  Case {id}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// What happened next: the instruction the worker got, the steps it took, and how its run ended.
function AfterVerdict({ trial, outcome, events }: { trial: Trial; outcome?: WorkerStatus; events: Map<number, Event> }) {
  const after = Math.max(0, ...trial.charge.eventIds);
  const next = [...events.values()].filter((e) => e.id > after).sort((a, b) => a.id - b.id).slice(0, 4);
  return (
    <section className="px-box pop flex flex-col gap-4 p-4" style={{ borderColor: RULING_COLOR[trial.verdict.ruling] }} aria-labelledby="after-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="after-h" className="text-[20px]">After the verdict</h2>
        {outcome ? <StatusTag state={outcome.state} /> : <span className="text-sm text-soft">{trial.workerId} is still running...</span>}
      </div>
      {trial.verdict.instruction && (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-soft">Sent to {trial.workerId}&apos;s next prompt</span>
          <p className="px-inset m-0 p-3">{trial.verdict.instruction}</p>
        </div>
      )}
      {next.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-soft">What it did next</span>
          <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
            {next.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </ul>
        </div>
      )}
      {outcome?.summary && (
        <p className="m-0 font-display text-[20px]" style={{ color: outcome.state === "succeeded" ? "var(--green)" : "var(--soft)" }}>
          {outcome.summary.replace(/\.$/, "")}. {usd(outcome.costUsd)} spent in total.
        </p>
      )}
    </section>
  );
}
