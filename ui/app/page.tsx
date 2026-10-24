"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, MONITORS, MonitorDots, RulingChip, Sparkline, StateChip } from "@/components/Console";
import { CHARGE_PHRASE, KIND_LABEL, RULING_LABEL, STATE_LABEL, clock, usd, type Charge, type Ruling, type Trial } from "@/lib/data";
import { useLive, type FeedItem, type LiveWorker } from "@/lib/live";
import { runCosts, savings, type ComparisonResult, type WorkerState } from "@/lib/stream";

// The console: the serious half of the UI (ART.md, "Two modes"). The courtroom replay is one click away on each case.

export default function Overview() {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const workers = live.order.map((id) => live.workers[id]);

  return (
    <div className="flex flex-col gap-6">
      {live.openCharges.map((c) => (
        <InSession key={`${c.workerId}-${c.id}`} charge={c} trial={live.trialFor(c.workerId, c.id ?? 0)} />
      ))}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px]">Overview</h1>
          <p className="m-0 text-c-soft">Code monitors check every step each worker takes. When one flags a worker, the court hears both sides and rules.</p>
        </div>
        <RunControls />
      </div>

      <Kpis />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card self-start overflow-x-auto" aria-labelledby="workers-h">
          <div className="flex items-center gap-3 px-4 pt-4">
            <h2 id="workers-h" className="text-[15px]">Workers</h2>
            {live.simulatedCosts && <span className="chip">Simulated spend</span>}
          </div>
          {workers.length === 0 ? (
            <p className="m-0 p-4 text-c-soft">Waiting for the first worker to start.</p>
          ) : (
            <table className="data mt-2">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>State</th>
                  <th>Tests passing</th>
                  <th>Spend</th>
                  <th>Steps</th>
                  <th>Monitors</th>
                  <th>Last ruling</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <WorkerRow key={w.status.workerId} worker={w} selected={selected === w.status.workerId} onSelect={() => setSelected(selected === w.status.workerId ? null : w.status.workerId)} />
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <ComparisonCard comparison={live.comparison} error={live.comparisonError} />
          <section className="card flex flex-col gap-3 p-4" aria-labelledby="mon-h">
            <h2 id="mon-h" className="text-[15px]">Monitors</h2>
            <p className="m-0 text-[13px] text-c-soft">Plain code with no model calls, so watching costs nothing. Court only convenes when one fires.</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
              {MONITORS.map((m) => (
                <li key={m.kind} className="grid grid-cols-[96px_1fr] gap-2">
                  <span className="font-medium">{KIND_LABEL[m.kind]}</span>
                  <span className="text-c-soft">{m.rule}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <Interventions />

      <ActivityLog only={selected} onClear={() => setSelected(null)} />
    </div>
  );
}

const chipColor = (c: string) => ({ "--chip": c }) as React.CSSProperties;

// ---------- alert ----------

function InSession({ charge, trial }: { charge: Charge; trial?: Trial }) {
  return (
    <section className="card flex flex-wrap items-center gap-4 p-4" style={{ borderColor: "var(--red)", borderLeftWidth: 4 }} aria-live="assertive">
      <span className="chip pulse-soft" style={chipColor("var(--red)")}>
        Court in session
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">
          {charge.workerId} is charged with {CHARGE_PHRASE[charge.kind]}. The worker is paused.
        </span>
        <span className="line-clamp-1 text-[13px] text-c-soft">
          {charge.summary}. Evidence: {charge.eventIds.map((n) => `event ${n}`).join(", ")}.
        </span>
      </div>
      {trial && (
        <div className="flex gap-2">
          <Link href={`/court/${trial.id}?view=record`} className="btn">Open the record</Link>
          <Link href={`/court/${trial.id}`} className="btn danger">Watch the trial</Link>
        </div>
      )}
    </section>
  );
}

// ---------- run controls ----------

function RunControls() {
  const live = useLive();
  const label = {
    connecting: "Connecting to the engine",
    live: "Live from the engine",
    disconnected: "Disconnected from the engine, showing the last data received",
    replay: "Replaying a recorded run",
  }[live.source];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px]" style={{ color: live.source === "disconnected" ? "var(--amber)" : "var(--c-soft)" }}>
        {label}
        {live.source === "replay" ? ` (${Math.round(live.progress * 100)}%)` : ""}
      </span>
      {live.source === "replay" && (
        <>
          <button type="button" className="btn" onClick={() => live.setPlaying(!live.playing)}>
            {live.playing ? "Pause" : "Play"}
          </button>
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className="btn" aria-pressed={live.speed === s} onClick={() => live.setSpeed(s)}>
              {s}x
            </button>
          ))}
          <button type="button" className="btn" onClick={live.restart}>
            Restart
          </button>
        </>
      )}
    </div>
  );
}

// ---------- headline numbers ----------

function countBy<T extends string>(items: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()];
}

function Kpis() {
  const live = useLive();
  const workers = Object.values(live.workers);
  const steps = workers.reduce((s, w) => s + w.events.length, 0);
  const courtSpend = live.runTrials.reduce((s, t) => s + t.costUsd, 0);
  const mock = live.runTrials.some((t) => t.mock);
  const cmp = live.comparison;
  const saved = cmp ? savings(cmp) : null;
  const rulings = countBy<Ruling>(live.runTrials.map((t) => t.verdict.ruling));
  const states = countBy<WorkerState>(workers.map((w) => w.status.state));

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Headline numbers">
      <Kpi
        value={saved ? usd(saved.usd) : cmp ? "Incomplete" : "–"}
        label="Saved vs. running unsupervised"
        detail={
          saved && cmp
            ? `${Math.round(saved.percent)}% less than the same task without the court, which ${cmp.withoutCourt.state === "succeeded" ? "also finished" : "never finished"}.`
            : cmp
              ? "Some court costs weren't reported, so the total is incomplete."
              : "Appears when the unsupervised run of the same task finishes."
        }
        accent={saved ? "var(--green)" : undefined}
      />
      <Kpi
        value={String(live.runTrials.length)}
        label="Interventions"
        detail={rulings.length ? rulings.map(([r, n]) => `${n} ${RULING_LABEL[r].toLowerCase()}`).join(" · ") : "No trials yet."}
      />
      <Kpi value={usd(courtSpend)} label="Cost of oversight" detail={`Monitors checked ${steps} steps with no model calls.${mock ? " The court ran in mock mode." : ""}`} />
      <Kpi value={String(workers.length)} label="Workers" detail={states.map(([s, n]) => `${n} ${STATE_LABEL[s].toLowerCase()}`).join(" · ") || "None yet."} />
    </section>
  );
}

function Kpi({ value, label, detail, accent }: { value: string; label: string; detail: string; accent?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-[13px] text-c-soft">{label}</span>
      <span className="text-[30px] font-semibold leading-tight" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-[13px] text-c-soft">{detail}</span>
    </div>
  );
}

// ---------- workers ----------

function WorkerRow({ worker: w, selected, onSelect }: { worker: LiveWorker; selected: boolean; onSelect: () => void }) {
  const live = useLive();
  const s = w.status;
  const lastCharge = w.charges.at(-1);
  const lastRuling = w.rulings.at(-1);
  const open = live.openCharges.filter((c) => c.workerId === s.workerId).map((c) => c.kind);
  const lit = s.state === "halted" && lastCharge ? [lastCharge.kind] : open;
  return (
    <tr onClick={onSelect} className="cursor-pointer" style={{ background: selected ? "var(--c-raise)" : undefined }}>
      <td>
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-medium text-c-text" aria-pressed={selected}>
          {s.workerId}
        </button>
      </td>
      <td>
        <StateChip state={s.state} />
      </td>
      <td>
        <span className="flex items-center gap-3">
          <Sparkline events={w.events} total={s.testsTotal} />
          <span>
            {s.testsPassing}/{s.testsTotal}
          </span>
        </span>
      </td>
      <td className="min-w-[140px]">
        <div className="flex flex-col gap-1.5">
          <span>
            {usd(s.costUsd)} <span className="text-c-soft">of {usd(s.budgetUsd)}</span>
          </span>
          <Bar value={s.costUsd} max={s.budgetUsd} color="var(--amber)" warnAt={0.8} label={`${s.workerId} spend`} />
        </div>
      </td>
      <td>{s.step}</td>
      <td>
        <MonitorDots lit={lit} />
      </td>
      <td>{lastRuling ? <RulingChip ruling={lastRuling.verdict.ruling} /> : <span className="text-c-soft">None</span>}</td>
    </tr>
  );
}

// ---------- with vs. without ----------

function duration(s?: number): string {
  if (!s) return "";
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

function ComparisonCard({ comparison, error }: { comparison?: ComparisonResult; error?: string }) {
  if (!comparison) {
    return (
      <section className="card flex flex-col gap-2 p-4" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="text-[15px]">With the court vs. without</h2>
        <p className="m-0 text-[13px]" style={{ color: error ? "var(--amber)" : "var(--c-soft)" }}>
          {error ? `The comparison run failed: ${error}` : "The same task also runs with the court turned off. Both results land here when the runs finish."}
        </p>
      </section>
    );
  }
  const rows = [
    { label: "With the court", run: comparison.withCourt },
    { label: "Without the court", run: comparison.withoutCourt },
  ];
  const scale = Math.max(...rows.map((r) => runCosts(r.run).total ?? r.run.costUsd), comparison.withCourt.budgetUsd);
  return (
    <section className="card flex flex-col gap-4 p-4" aria-labelledby="cmp-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="cmp-h" className="text-[15px]">With the court vs. without</h2>
        {comparison.costMode === "simulated" && <span className="chip">Simulated costs</span>}
      </div>
      {rows.map(({ label, run }) => {
        const ok = run.state === "succeeded";
        const cost = runCosts(run);
        return (
          <div key={label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-medium">{label}</span>
              <span className="chip" style={chipColor(ok ? "var(--green)" : "var(--red)")}>
                {ok ? "Finished" : run.summary?.startsWith("Ran out of budget") ? "Ran out of budget" : "Did not finish"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--c-line)" }}>
              <div className="h-full rounded-full" style={{ width: `${((cost.total ?? run.costUsd) / scale) * 100}%`, background: ok ? "var(--green)" : "var(--red)" }} />
            </div>
            <span className="text-[13px] text-c-soft">
              {cost.total === null ? "Total incomplete" : usd(cost.total)}
              {cost.court !== undefined ? ` (worker ${usd(cost.worker)} + court ${usd(cost.court)}${cost.courtComplete ? "" : " + unknown"})` : ""} · {run.testsPassing}/{run.testsTotal} tests · {duration(run.seconds)}
            </span>
          </div>
        );
      })}
    </section>
  );
}

// ---------- interventions ----------

function Interventions() {
  const live = useLive();
  const pending = live.openCharges.map((c) => ({ charge: c, trial: live.trialFor(c.workerId, c.id ?? 0), ruled: false }));
  const ruled = live.runTrials.map((t) => ({ charge: t.charge, trial: t as Trial | undefined, ruled: true }));
  const rows = [...pending, ...ruled.toReversed()];
  return (
    <section className="card overflow-x-auto" aria-labelledby="int-h">
      <h2 id="int-h" className="px-4 pt-4 text-[15px]">Interventions</h2>
      {rows.length === 0 ? (
        <p className="m-0 p-4 text-c-soft">No monitor has flagged a worker yet.</p>
      ) : (
        <table className="data mt-2">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Charge</th>
              <th>Evidence</th>
              <th>Ruling</th>
              <th>Instruction to the worker</th>
              <th>Court cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ charge, trial, ruled }) => (
              <tr key={`${charge.workerId}-${charge.id}`}>
                <td className="font-medium">{charge.workerId}</td>
                <td>{KIND_LABEL[charge.kind]}</td>
                <td className="whitespace-nowrap text-c-soft">{charge.eventIds.length > 4 ? `${charge.eventIds.length} events` : charge.eventIds.map((n) => `#${n}`).join(", ")}</td>
                <td>
                  {ruled && trial ? (
                    <span className="flex items-center gap-2">
                      <RulingChip ruling={trial.verdict.ruling} />
                      {trial.summary && <span className="text-[12px] text-c-soft">summary judgment</span>}
                    </span>
                  ) : (
                    <span className="chip pulse-soft" style={chipColor("var(--red)")}>
                      In session
                    </span>
                  )}
                </td>
                <td className="max-w-[360px]">
                  <span className="line-clamp-2 text-c-soft">{ruled ? (trial?.verdict.instruction ?? "None: the worker carries on as before.") : "Waiting for the Judge"}</span>
                </td>
                <td className="whitespace-nowrap">{trial && ruled ? `${usd(trial.costUsd)}${trial.mock ? " (mock)" : ""}` : ""}</td>
                <td>
                  {trial && (
                    <span className="flex justify-end gap-2">
                      <Link href={`/court/${trial.id}?view=record`} className="btn">Record</Link>
                      <Link href={`/court/${trial.id}`} className="btn">Replay</Link>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- activity ----------

const TONE_COLOR: Record<FeedItem["tone"], string> = {
  event: "var(--c-line)",
  fail: "var(--red)",
  charge: "var(--red)",
  verdict: "var(--gold)",
  done: "var(--green)",
};

function ActivityLog({ only, onClear }: { only: string | null; onClear: () => void }) {
  const live = useLive();
  const rows = live.feed.filter((r) => !only || r.workerId === only).slice(0, 80);
  return (
    <section className="card" aria-labelledby="log-h">
      <div className="flex items-center gap-3 px-4 pt-4">
        <h2 id="log-h" className="text-[15px]">Activity{only ? ` for ${only}` : ""}</h2>
        {only && (
          <button type="button" className="btn" onClick={onClear}>
            Show all workers
          </button>
        )}
      </div>
      <ol className="m-0 mt-2 flex max-h-[360px] list-none flex-col overflow-y-auto p-0 text-[13px]">
        {rows.length === 0 && <li className="px-4 py-3 text-c-soft">Nothing yet.</li>}
        {rows.map((r) => {
          const trial = r.charge ? live.trialFor(r.charge.workerId, r.charge.id) : undefined;
          return (
            <li key={r.seq} className="grid grid-cols-[10px_88px_72px_1fr] items-baseline gap-3 border-b px-4 py-1.5" style={{ borderColor: "var(--c-line)" }}>
              <span aria-hidden className="size-2 rounded-[2px]" style={{ background: TONE_COLOR[r.tone] }} />
              <span className="text-c-soft">{clock(r.at)}</span>
              <span>{r.workerId}</span>
              {trial ? (
                <Link href={`/court/${trial.id}?view=record`} className="font-medium underline underline-offset-2">
                  {r.text}
                </Link>
              ) : (
                <span style={{ color: r.tone === "fail" ? "#ff8a9a" : r.tone === "done" ? "var(--green)" : undefined }}>{r.text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
