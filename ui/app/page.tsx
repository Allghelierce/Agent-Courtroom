"use client";

import Link from "next/link";
import { useState } from "react";
import { CourtScene } from "@/components/CourtScene";
import { Meter, PixelIcon, RulingTag, StatusTag, WarningLights } from "@/components/Pieces";
import { Chibi } from "@/components/Sprites";
import { KIND_LABEL, clock, describeEvent, eventFailed, repoFor, useCourtData, usd, type Trial, type WorkerView } from "@/lib/data";
import type { Mood } from "@/lib/sprites";

const WORKER_MOOD: Record<WorkerView["status"], Mood> = {
  working: "happy",
  on_trial: "dizzy",
  new_plan: "neutral",
  needs_human: "worried",
  halted: "worried",
};

export default function Dashboard() {
  const { trials, workers, source } = useCourtData();
  const [selected, setSelected] = useState<string | null>(null);
  // Lead with the latest time the court stepped in; a "keep going" ruling only if there's nothing else.
  const latest = trials.findLast((t) => t.verdict.ruling !== "continue") ?? trials.at(-1);

  const agentSpend = workers.reduce((s, w) => s + w.spendUsd, 0);
  const courtSpend = trials.reduce((s, t) => s + t.costUsd, 0);
  const steps = workers.reduce((s, w) => s + w.events.length, 0);

  return (
    <div className="flex flex-col gap-8">
      {latest && <LatestCase trial={latest} />}

      <section className="px-box flex flex-wrap items-center gap-x-10 gap-y-4 px-6 py-4" aria-label="Totals">
        <Stat label="Workers watched" value={String(workers.length)} />
        <Stat label="Steps checked by monitors" value={String(steps)} />
        <Stat label="Agent spend" value={usd(agentSpend)} />
        <Stat label="Court spend" value={usd(courtSpend)} />
        <Stat label="Trials held" value={String(trials.length)} />
        <span className="ml-auto text-sm text-soft">{source === "live" ? "Live from the court server" : "Demo data (court server offline)"}</span>
      </section>

      <section aria-labelledby="workers-h" className="flex flex-col gap-4">
        <h2 id="workers-h" className="text-[20px]">Workers</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {workers.map((w) => (
            <WorkerCard key={w.id} worker={w} selected={selected === w.id} onSelect={() => setSelected(selected === w.id ? null : w.id)} />
          ))}
        </div>
      </section>

      <ActivityFeed workers={workers} trials={trials} only={selected} onClear={() => setSelected(null)} />
    </div>
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

function LatestCase({ trial }: { trial: Trial }) {
  return (
    <section className="px-box grid gap-6 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:p-6" aria-labelledby="latest-h">
      <div className="self-start border-4 border-edge bg-[#2a1d4a]">
        <CourtScene speaker="judge" moods={{ worker: trial.verdict.ruling === "continue" ? "happy" : "worried", pros: "angry", def: "neutral" }} swirl={trial.charge.kind === "looping"} workerLabel={trial.workerId} maxScale={4} />
      </div>
      <div className="flex flex-col justify-center gap-4">
        <span className="text-sm text-soft">Latest intervention, {clock(trial.finishedAt)}</span>
        <h1 id="latest-h" className="text-[28px]">
          {trial.workerId} was charged with {KIND_LABEL[trial.charge.kind].toLowerCase()}
        </h1>
        <p className="m-0">{trial.charge.summary}.</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">The court ruled</span>
          <RulingTag ruling={trial.verdict.ruling} />
        </div>
        {trial.verdict.instruction && <p className="px-inset m-0 p-3 text-sm">{trial.verdict.instruction}</p>}
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

function WorkerCard({ worker: w, selected, onSelect }: { worker: WorkerView; selected: boolean; onSelect: () => void }) {
  const last = w.events.at(-1);
  const trial = w.trials.at(-1);
  const overBudget = w.spendUsd / w.budgetUsd;
  return (
    <article className="px-box flex flex-col gap-4 p-4" style={selected ? { outline: "4px solid var(--amber)", outlineOffset: 4 } : undefined}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-text">
        <span className="px-inset shrink-0 p-1">
          <Chibi who="worker" mood={WORKER_MOOD[w.status]} scale={2} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[20px] leading-none">{w.id}</span>
          <span className="text-sm text-soft">{w.repo}</span>
          <StatusTag status={w.status} />
        </span>
      </button>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span>Tests passing</span>
          <span>{w.testsPassing} / {w.testsTotal}</span>
        </div>
        <Meter value={w.testsPassing} max={w.testsTotal} color="var(--green)" label={`${w.id} tests passing`} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span>Spend</span>
          <span>{usd(w.spendUsd)} of {usd(w.budgetUsd)}</span>
        </div>
        <Meter value={w.spendUsd} max={w.budgetUsd} cells={20} color={overBudget > 0.8 ? "var(--red)" : "var(--gold)"} label={`${w.id} spend`} />
      </div>

      <WarningLights lit={w.lights} />

      {last && <p className="m-0 line-clamp-2 text-sm text-soft">Last step: {describeEvent(last)}</p>}

      {trial && (
        <Link href={`/court/${trial.id}`} className="px-btn ghost mt-auto justify-center">
          <PixelIcon name="gavel" />
          Watch the trial
        </Link>
      )}
    </article>
  );
}

function ActivityFeed({ workers, trials, only, onClear }: { workers: WorkerView[]; trials: Trial[]; only: string | null; onClear: () => void }) {
  type Row = { key: string; at: string; worker: string; text: string; tone: "event" | "error" | "trial"; href?: string };
  const rows: Row[] = [
    ...workers.flatMap((w) =>
      w.events.map((e) => ({
        key: `${w.id}-${e.id}`,
        at: e.timestamp,
        worker: w.id,
        text: `event ${e.id}: ${describeEvent(e)}${e.error ? `. ${e.error}` : ""}`,
        tone: (eventFailed(e) ? "error" : "event") as Row["tone"],
      })),
    ),
    ...trials.map((t) => ({
      key: t.id,
      at: t.finishedAt,
      worker: t.workerId,
      text: `Court ruled "${t.verdict.ruling.replace("_", " ")}" on a ${t.charge.kind} charge`,
      tone: "trial" as const,
      href: `/court/${t.id}`,
    })),
  ]
    .filter((r) => !only || r.worker === only)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);

  const toneColor = { event: "var(--green)", error: "var(--red)", trial: "var(--gold)" };

  return (
    <section aria-labelledby="feed-h" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h2 id="feed-h" className="text-[20px]">
          Activity{only ? ` for ${only} (${repoFor(only)})` : ""}
        </h2>
        {only && (
          <button type="button" className="px-btn ghost" onClick={onClear}>
            Show all workers
          </button>
        )}
      </div>
      <ol className="px-box m-0 flex max-h-[420px] list-none flex-col overflow-y-auto p-0">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-start gap-3 px-4 py-2" style={{ background: i % 2 ? "var(--inset)" : undefined }}>
            <span aria-hidden className="mt-1.5 inline-block size-3 shrink-0 border-2 border-edge" style={{ background: toneColor[r.tone] }} />
            <span className="w-20 shrink-0 text-sm text-soft">{clock(r.at)}</span>
            <span className="w-24 shrink-0 text-sm">{r.worker}</span>
            {r.href ? (
              <Link href={r.href} className="min-w-0 text-sm underline decoration-2 underline-offset-4">
                {r.text}
              </Link>
            ) : (
              <span className="min-w-0 text-sm" style={{ color: r.tone === "error" ? "#ff8a9a" : undefined }}>
                {r.text}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
