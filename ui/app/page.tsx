"use client";

import Link from "next/link";
import { useState } from "react";
import { CourtScene } from "@/components/CourtScene";
import { Meter, PixelIcon, RulingTag, StatusTag, WarningLights } from "@/components/Pieces";
import { Chibi } from "@/components/Sprites";
import { CHARGE_PHRASE, clock, describeEvent, usd, type Charge, type Trial } from "@/lib/data";
import { useLive, type FeedItem, type LiveWorker } from "@/lib/live";
import type { Mood } from "@/lib/sprites";
import type { Comparison, WorkerStatus } from "@/lib/stream";

export default function Dashboard() {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const workers = live.order.map((id) => live.workers[id]);
  // Lead with the latest time the court stepped in; a "keep going" ruling only if there's nothing else.
  const latest = live.runTrials.findLast((t) => t.verdict.ruling !== "continue") ?? live.runTrials.at(-1);

  return (
    <div className="flex flex-col gap-8">
      {live.openCharges.map((c) => (
        <InSession key={`${c.workerId}-${c.id}`} charge={c} trial={live.trialFor(c.workerId, c.id ?? 0)} />
      ))}

      {latest ? <LatestCase trial={latest} /> : <QuietCourt />}

      <RunBar />

      <ComparisonPanel comparison={live.comparison} />

      <section aria-labelledby="workers-h" className="flex flex-col gap-4">
        <h2 id="workers-h" className="text-[20px]">Workers</h2>
        {workers.length === 0 ? (
          <p className="px-box m-0 p-6 text-soft">Waiting for the first worker to start...</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {workers.map((w) => (
              <WorkerCard key={w.status.workerId} worker={w} selected={selected === w.status.workerId} onSelect={() => setSelected(selected === w.status.workerId ? null : w.status.workerId)} />
            ))}
          </div>
        )}
      </section>

      <ActivityFeed only={selected} onClear={() => setSelected(null)} />
    </div>
  );
}

// ---------- court in session ----------

function InSession({ charge, trial }: { charge: Charge; trial?: Trial }) {
  return (
    <section className="px-box flex flex-wrap items-center gap-4 p-4" style={{ borderColor: "var(--red)" }} aria-live="assertive">
      <span className="px-inset p-1">
        <Chibi who="worker" mood={charge.kind === "looping" ? "dizzy" : "worried"} scale={2} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="px-tag pulse-step self-start" style={{ background: "var(--red)", color: "var(--on-accent)" }}>
          Court is in session
        </span>
        <h2 className="text-[20px]">
          {charge.workerId} is charged with {CHARGE_PHRASE[charge.kind]}
        </h2>
        <p className="m-0 line-clamp-2 text-sm text-soft">{charge.summary}</p>
      </div>
      {trial && (
        <Link href={`/court/${trial.id}`} className="px-btn red">
          <PixelIcon name="gavel" />
          Watch the trial
        </Link>
      )}
    </section>
  );
}

function LatestCase({ trial }: { trial: Trial }) {
  return (
    <section className="px-box grid gap-6 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:p-6" aria-labelledby="latest-h">
      <div className="self-start border-4 border-edge bg-[#2a1d4a]">
        <CourtScene speaker="judge" moods={{ worker: trial.verdict.ruling === "halt" ? "worried" : "happy", pros: "angry", def: "neutral" }} swirl={false} workerLabel={trial.workerId} maxScale={4} />
      </div>
      <div className="flex flex-col justify-center gap-4">
        <span className="text-sm text-soft">Latest intervention</span>
        <h1 id="latest-h" className="text-[28px]">
          {trial.workerId} was charged with {CHARGE_PHRASE[trial.charge.kind]}
        </h1>
        <p className="m-0 line-clamp-3">{trial.charge.summary}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">The court ruled</span>
          <RulingTag ruling={trial.verdict.ruling} />
        </div>
        {trial.verdict.instruction && <p className="px-inset m-0 line-clamp-4 p-3 text-sm">{trial.verdict.instruction}</p>}
        <div>
          <Link href={`/court/${trial.id}`} className="px-btn red">
            <PixelIcon name="gavel" />
            Watch the trial
          </Link>
        </div>
      </div>
    </section>
  );
}

function QuietCourt() {
  return (
    <section className="px-box grid gap-6 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:p-6" aria-labelledby="quiet-h">
      <div className="self-start border-4 border-edge bg-[#2a1d4a]">
        <CourtScene speaker={null} moods={{ worker: "happy", judge: "happy" }} workerLabel="a worker" maxScale={4} />
      </div>
      <div className="flex flex-col justify-center gap-4">
        <h1 id="quiet-h" className="text-[28px]">The court is waiting</h1>
        <p className="m-0">
          Cheap code monitors check every step each worker takes. Court only convenes when one of them flags a worker that is looping, stuck, overspending, or flailing.
        </p>
      </div>
    </section>
  );
}

// ---------- run status and replay controls ----------

function RunBar() {
  const live = useLive();
  const workers = Object.values(live.workers);
  const steps = workers.reduce((s, w) => s + w.events.length, 0);
  const agentSpend = workers.reduce((s, w) => s + w.status.costUsd, 0);
  const courtSpend = live.runTrials.reduce((s, t) => s + t.costUsd, 0);
  const sourceLabel = { connecting: "Connecting to the engine...", live: "Live from the engine", replay: "Demo replay of a recorded run" }[live.source];

  return (
    <section className="px-box flex flex-wrap items-center gap-x-10 gap-y-4 px-6 py-4" aria-label="Run totals">
      <Stat label="Workers watched" value={String(workers.length)} />
      <Stat label="Steps checked by monitors" value={String(steps)} />
      <Stat label="Agent spend" value={usd(agentSpend)} />
      <Stat label={live.runTrials.some((t) => t.mock) ? "Court spend (mock)" : "Court spend"} value={usd(courtSpend)} />
      <Stat label="Trials held" value={String(live.runTrials.length)} />
      <div className="ml-auto flex flex-col items-end gap-2">
        <span className="text-sm text-soft">
          {sourceLabel}
          {live.source === "replay" ? `, ${Math.round(live.progress * 100)}%` : ""}
        </span>
        {live.source === "replay" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="px-btn ghost" onClick={() => live.setPlaying(!live.playing)}>
              {live.playing ? "Pause" : "Play"}
            </button>
            {[1, 2, 4].map((s) => (
              <button key={s} type="button" className={`px-btn ${live.speed === s ? "" : "ghost"}`} aria-pressed={live.speed === s} onClick={() => live.setSpeed(s)}>
                {s}x
              </button>
            ))}
            <button type="button" className="px-btn ghost" onClick={live.restart}>
              Restart
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-[28px] leading-none">{value}</span>
      <span className="text-sm text-soft">{label}</span>
    </div>
  );
}

// ---------- with vs. without the court ----------

function minutes(s?: number): string {
  if (!s) return "";
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function ComparisonPanel({ comparison }: { comparison?: Comparison }) {
  if (!comparison) {
    return (
      <section className="px-box flex flex-col gap-2 p-6" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="text-[20px]">With the court vs. without it</h2>
        <p className="m-0 text-soft">The same task also runs once with the court turned off. The comparison appears here when both runs finish.</p>
      </section>
    );
  }
  const { withCourt: a, withoutCourt: b } = comparison;
  const scale = Math.max(a.costUsd, b.costUsd, a.budgetUsd);
  const saved = b.costUsd - a.costUsd;
  return (
    <section className="px-box flex flex-col gap-5 p-6" aria-labelledby="cmp-h">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="cmp-h" className="text-[20px]">With the court vs. without it</h2>
        <p className="m-0 font-display text-[20px]" style={{ color: "var(--gold)" }}>
          {saved > 0 ? `The court saved ${usd(saved)} (${Math.round((saved / b.costUsd) * 100)}%)` : "Same cost either way"}
          {a.state === "succeeded" && b.state !== "succeeded" ? " and the task finished" : ""}
        </p>
      </div>
      <RunRow label="With the court" run={a} scale={scale} />
      <RunRow label="Without the court" run={b} scale={scale} />
    </section>
  );
}

function RunRow({ label, run, scale }: { label: string; run: WorkerStatus; scale: number }) {
  const ok = run.state === "succeeded";
  const cells = 24;
  const budgetCell = Math.round((run.budgetUsd / scale) * cells);
  const filled = Math.round((run.costUsd / scale) * cells);
  return (
    <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_220px] md:items-center">
      <span className="font-display">{label}</span>
      <div className="flex flex-col gap-1">
        <div className="flex gap-1" role="meter" aria-label={`${label}: spend`} aria-valuenow={run.costUsd} aria-valuemin={0} aria-valuemax={scale}>
          {Array.from({ length: cells }, (_, i) => (
            <span key={i} className="h-4 flex-1 border-2 border-edge" style={{ background: i < filled ? (i >= budgetCell ? "var(--red)" : "var(--amber)") : "var(--inset)" }} />
          ))}
        </div>
        <span className="text-sm text-soft">
          {usd(run.costUsd)} of a {usd(run.budgetUsd)} budget · {run.testsPassing}/{run.testsTotal} tests · {minutes(run.seconds)}
        </span>
      </div>
      <span className="px-tag justify-self-start md:justify-self-end" style={{ background: ok ? "var(--green)" : "var(--red)", color: "var(--on-accent)" }}>
        {ok ? "Finished" : run.summary?.startsWith("Ran out of budget") ? "Ran out of budget" : "Did not finish"}
      </span>
    </div>
  );
}

// ---------- workers ----------

function moodFor(w: LiveWorker): Mood {
  const open = w.charges.at(-1);
  switch (w.status.state) {
    case "running":
    case "succeeded":
      return "happy";
    case "on_trial":
      return open?.kind === "looping" ? "dizzy" : "worried";
    default:
      return "worried";
  }
}

function WorkerCard({ worker: w, selected, onSelect }: { worker: LiveWorker; selected: boolean; onSelect: () => void }) {
  const live = useLive();
  const s = w.status;
  const last = w.events.at(-1);
  const lastCharge = w.charges.at(-1);
  const lastRuling = w.rulings.at(-1);
  const trial = lastCharge ? live.trialFor(s.workerId, lastCharge.id ?? 0) : undefined;
  const open = live.openCharges.filter((c) => c.workerId === s.workerId).map((c) => c.kind);
  const lights = s.state === "halted" && lastCharge ? [lastCharge.kind] : open;
  const onTrial = s.state === "on_trial";

  return (
    <article
      className="px-box flex flex-col gap-4 p-4"
      style={{ borderColor: onTrial ? "var(--red)" : undefined, outline: selected ? "4px solid var(--gold)" : undefined, outlineOffset: 4 }}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-text">
        <span className="px-inset shrink-0 p-1">
          <Chibi who="worker" mood={moodFor(w)} scale={2} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[20px] leading-none">{s.workerId}</span>
          <span className="text-sm text-soft">Step {s.step}</span>
          <StatusTag state={s.state} />
        </span>
      </button>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span>Tests passing</span>
          <span>{s.testsPassing} / {s.testsTotal}</span>
        </div>
        <Meter value={s.testsPassing} max={s.testsTotal} color="var(--green)" label={`${s.workerId} tests passing`} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span>Spend</span>
          <span>{usd(s.costUsd)} of {usd(s.budgetUsd)}</span>
        </div>
        <Meter value={s.costUsd} max={s.budgetUsd} cells={20} color={s.costUsd / s.budgetUsd > 0.8 ? "var(--red)" : "var(--amber)"} label={`${s.workerId} spend`} />
      </div>

      <WarningLights lit={lights} />

      {lastRuling && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-soft">Court ruled</span>
          <RulingTag ruling={lastRuling.verdict.ruling} />
        </div>
      )}

      <p className="m-0 line-clamp-2 text-sm text-soft">{s.summary ?? (last ? `Last step: ${describeEvent(last)}` : "Starting up...")}</p>

      {trial && (
        <Link href={`/court/${trial.id}`} className={`px-btn ${onTrial ? "red" : "ghost"} mt-auto justify-center`}>
          <PixelIcon name="gavel" />
          Watch the trial
        </Link>
      )}
    </article>
  );
}

// ---------- activity ----------

const TONE_COLOR: Record<FeedItem["tone"], string> = {
  event: "var(--green)",
  fail: "var(--red)",
  charge: "var(--red)",
  verdict: "var(--gold)",
  done: "var(--gold)",
};

function ActivityFeed({ only, onClear }: { only: string | null; onClear: () => void }) {
  const live = useLive();
  const rows = live.feed.filter((r) => !only || r.workerId === only).slice(0, 60);
  return (
    <section aria-labelledby="feed-h" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h2 id="feed-h" className="text-[20px]">Activity{only ? ` for ${only}` : ""}</h2>
        {only && (
          <button type="button" className="px-btn ghost" onClick={onClear}>
            Show all workers
          </button>
        )}
      </div>
      <ol className="px-box m-0 flex max-h-[420px] list-none flex-col overflow-y-auto p-0">
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-soft">Nothing yet.</li>}
        {rows.map((r, i) => {
          const trial = r.charge ? live.trialFor(r.charge.workerId, r.charge.id) : undefined;
          const strong = r.tone === "charge" || r.tone === "verdict";
          return (
            <li key={r.seq} className="flex items-start gap-3 px-4 py-2" style={{ background: i % 2 ? "var(--inset)" : undefined }}>
              <span aria-hidden className="mt-1.5 inline-block size-3 shrink-0 border-2 border-edge" style={{ background: TONE_COLOR[r.tone] }} />
              <span className="w-20 shrink-0 text-sm text-soft">{clock(r.at)}</span>
              <span className="w-20 shrink-0 text-sm">{r.workerId}</span>
              {trial ? (
                <Link href={`/court/${trial.id}`} className={`min-w-0 text-sm underline decoration-2 underline-offset-4 ${strong ? "font-display" : ""}`}>
                  {r.text}
                </Link>
              ) : (
                <span className="min-w-0 text-sm" style={{ color: r.tone === "fail" ? "#ff8a9a" : undefined }}>
                  {r.text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
