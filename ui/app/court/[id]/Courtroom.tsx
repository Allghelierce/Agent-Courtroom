"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CourtScene } from "@/components/CourtScene";
import { RulingTag } from "@/components/Pieces";
import { Portrait } from "@/components/Sprites";
import { COURT_URL, KIND_LABEL, RULING_COLOR, RULING_LABEL, describeEvent, eventFailed, repoFor, runFor, useCourtData, usd, type Trial } from "@/lib/data";
import { buildScript } from "@/lib/script";
import { CAST } from "@/lib/sprites";

const AUTO_DELAY_MS = 2600;
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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
  const { trials, loading } = useCourtData(10000);
  const [fetched, setFetched] = useState<Trial | null>(null);
  const listed = trials.find((t) => t.id === id);
  const trial = listed ?? fetched;

  // A case that isn't in the list yet (just convened) can still be opened directly.
  useEffect(() => {
    if (listed || loading) return;
    fetch(`${COURT_URL}/cases/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((t: Trial | null) => t && setFetched(t))
      .catch(() => {});
  }, [id, listed, loading]);

  if (!trial) {
    return (
      <div className="px-box flex flex-col items-start gap-4 p-6">
        <h1 className="text-[28px]">{loading ? "Calling the court to order..." : "No case with that number"}</h1>
        {!loading && <p className="m-0">Case {id} isn&apos;t in the case log. Pick a trial from the list to watch it.</p>}
        <Link href="/cases" className="px-btn">Open the case log</Link>
      </div>
    );
  }
  return <Trial key={trial.id} trial={trial} />;
}

function Trial({ trial }: { trial: Trial }) {
  const script = useMemo(() => buildScript(trial), [trial]);
  const run = runFor(trial.workerId);
  const [idx, setIdx] = useState(0);
  // How much of which line has been typed; a new line starts at 0 without resetting state in an effect.
  const [typed, setTyped] = useState({ idx: 0, n: 0 });
  const [auto, setAuto] = useState(true);
  const still = useReducedMotion();
  const line = script[idx];
  const shown = still ? line.text.length : typed.idx === idx ? typed.n : 0;
  const done = shown >= line.text.length;
  const reachedVerdict = script.slice(0, idx + 1).some((l) => l.verdict);
  const last = idx === script.length - 1;

  // Type the line out two characters per frame.
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => {
      setTyped((t) => {
        const n = t.idx === idx ? t.n : 0;
        if (n >= line.text.length) {
          clearInterval(timer);
          return t;
        }
        return { idx, n: n + 2 };
      });
    }, 33);
    return () => clearInterval(timer);
  }, [idx, line, still]);

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
  const cited = new Set(line.cites ?? []);
  const evidence = (run?.events ?? []).filter((e) => cited.has(e.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/cases" className="text-sm text-ink-soft">Back to the case log</Link>
          <h1 className="text-[28px]">
            {trial.workerId} on {repoFor(trial.workerId)}: {KIND_LABEL[trial.charge.kind].toLowerCase()}
          </h1>
        </div>
        <span className="text-sm text-ink-soft">Case {trial.id}</span>
      </div>

      <div key={line.burst ? idx : "stage"} className={`relative overflow-hidden border-4 border-ink bg-[#b9a8ff] ${line.burst && !still ? "shake" : ""}`} style={{ boxShadow: "4px 4px 0 var(--ink)" }}>
        <button type="button" onClick={advance} aria-label="Next line" className="block w-full cursor-pointer border-0 bg-transparent p-0">
          <CourtScene
            speaker={line.who}
            moods={{ ...line.moods, [line.who]: line.mood }}
            swirl={trial.charge.kind === "looping" && !reachedVerdict}
            gavelDown={line.verdict}
            workerLabel={trial.workerId}
          />
        </button>
        {line.burst && <div className={`burst show ${line.burst.tone}`} aria-hidden>{line.burst.text}</div>}
        {line.verdict && <VerdictStamp trial={trial} />}

        {/* The dialogue box sits over the floor on wide screens, visual-novel style, and below the scene on phones. */}
        <div className="border-t-4 border-ink bg-paper lg:absolute lg:inset-x-0 lg:bottom-4 lg:mx-auto lg:max-w-[960px] lg:border-4 lg:shadow-[4px_4px_0_var(--ink)]" aria-live="polite">
          <div className="flex gap-4 p-3">
            <div className="hidden shrink-0 self-start border-4 border-ink sm:block">
              <Portrait who={line.who} mood={line.mood} scale={2} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="px-tag self-start" style={{ background: cast.tag }}>{name}</span>
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
        {last && done && <button type="button" className="px-btn ghost" onClick={() => setIdx(0)}>Replay the trial</button>}
        <span className="ml-auto text-sm text-ink-soft">Line {idx + 1} of {script.length}. Space or click for the next line.</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="px-box flex flex-col gap-3 p-4" aria-labelledby="evidence-h">
          <h2 id="evidence-h" className="text-[20px]">Evidence</h2>
          {evidence.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">{line.cites?.length ? `Cites ${line.cites.map((n) => `event ${n}`).join(", ")}.` : "No events cited in this line."}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {evidence.map((e) => (
                <li key={e.id} className="px-inset flex flex-col gap-1 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-display">event {e.id}</span>
                    <span>{e.testsPassing}/{e.testsTotal} tests · {usd(e.costUsd)}</span>
                  </div>
                  <span style={eventFailed(e) ? { color: "#b8264f" } : undefined}>{describeEvent(e)}</span>
                  {e.error && <span style={{ color: "#b8264f" }}>{e.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-box flex flex-col gap-3 p-4" aria-labelledby="facts-h">
          <h2 id="facts-h" className="text-[20px]">The case</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-soft">Charge</dt>
            <dd className="m-0">{trial.charge.summary}</dd>
            <dt className="text-ink-soft">Ruling</dt>
            <dd className="m-0">{reachedVerdict ? <RulingTag ruling={trial.verdict.ruling} /> : "Waiting for the Judge"}</dd>
            <dt className="text-ink-soft">Court cost</dt>
            <dd className="m-0">{usd(trial.costUsd)}{trial.mock ? " (mock run, no model calls)" : ""}</dd>
            <dt className="text-ink-soft">Models</dt>
            <dd className="m-0">Prosecution {trial.prosecution.model}, defense {trial.defense.model}, judge {trial.judgeModel}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

function VerdictStamp({ trial }: { trial: Trial }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-4">
      <div className="stamp border-4 border-ink px-5 py-3 text-center" style={{ background: RULING_COLOR[trial.verdict.ruling], boxShadow: "4px 4px 0 var(--ink)" }}>
        <div className="font-display text-sm">Verdict</div>
        <div className="font-display text-[28px] leading-none sm:text-[40px]">{RULING_LABEL[trial.verdict.ruling]}</div>
      </div>
    </div>
  );
}
