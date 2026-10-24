"use client";

import Link from "next/link";
import { RulingChip, StateChip } from "@/components/Console";
import { CHARGE_PHRASE, describeEvent, eventFailed, usd, type Event, type Trial } from "@/lib/data";
import { useCaseContext } from "@/lib/case";

// The Record view: the same case as the courtroom, as a plain audit record for anyone checking the work (ART.md, "The Record view").

const SIDES = [
  { key: "prosecution", label: "Prosecution", color: "var(--red)" },
  { key: "defense", label: "Defense", color: "var(--blue)" },
  { key: "judge", label: "Judge", color: "var(--gold)" },
] as const;

export function CaseRecord({ trial }: { trial: Trial }) {
  const { events, outcome } = useCaseContext(trial);
  const filedAt = Math.max(0, ...trial.charge.eventIds);
  const citedBy = new Map<number, string[]>();
  const cite = (ids: number[], who: string) => ids.forEach((id) => citedBy.set(id, [...(citedBy.get(id) ?? []), who]));
  cite(trial.prosecution.cited_events, "Prosecution");
  cite(trial.defense.cited_events, "Defense");
  cite(trial.verdict.cited_events, "Judge");

  // The evidence window: the steps up to the charge, plus anything cited.
  const window = [...events.values()].filter((e) => (e.id <= filedAt && e.id > filedAt - 40) || citedBy.has(e.id) || trial.charge.eventIds.includes(e.id)).sort((a, b) => a.id - b.id).slice(-14);
  const seconds = (Date.parse(trial.finishedAt) - Date.parse(trial.startedAt)) / 1000;

  return (
    <div className="console flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
        <Fact label="Charge">
          <span className="font-medium">{trial.workerId} was charged with {CHARGE_PHRASE[trial.charge.kind]}.</span>
          <span className="text-c-soft">{trial.charge.summary}.</span>
          <span className="text-c-soft">Filed after event {filedAt}. The worker was paused for the trial.</span>
        </Fact>
        <Fact label="Ruling">
          <RulingChip ruling={trial.verdict.ruling} />
          {trial.verdict.instruction ? (
            <>
              <span className="text-c-soft">Injected into the worker&apos;s next prompt:</span>
              <span>{trial.verdict.instruction}</span>
            </>
          ) : (
            <span className="text-c-soft">No instruction: the worker carries on as before.</span>
          )}
        </Fact>
        <Fact label="Outcome">
          {outcome ? (
            <>
              <StateChip state={outcome.state} />
              <span>{outcome.summary ?? `${outcome.testsPassing}/${outcome.testsTotal} tests passing`}</span>
              <span className="text-c-soft">{usd(outcome.costUsd)} spent by the worker in total.</span>
            </>
          ) : (
            <span className="text-c-soft">The worker is still running.</span>
          )}
        </Fact>
        <Fact label="Court">
          {trial.summary && (
            <span className="chip" style={{ "--chip": "var(--gold)" } as React.CSSProperties}>
              Summary judgment, no trial
            </span>
          )}
          {trial.priorCaseIds && trial.priorCaseIds.length > 0 && (
            <span className="text-c-soft">
              Rests on{" "}
              {trial.priorCaseIds.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link href={`/court/${id}?view=record`} className="underline underline-offset-2">{id}</Link>
                </span>
              ))}
              .
            </span>
          )}
          <span>
            {usd(trial.costUsd)}
            {trial.costComplete === false ? " + unknown" : ""}
            {trial.mock ? " (mock run, no model calls)" : ""}
          </span>
          <span className="text-c-soft">{trial.judgeModel === "none" ? "No models were called." : `Lawyers: ${trial.prosecution.model}. Judge: ${trial.judgeModel}.`}</span>
          {seconds > 0 && <span className="text-c-soft">Deliberated for {seconds < 1 ? "under a second" : `${Math.round(seconds)} s`}.</span>}
        </Fact>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Arguments">
        {SIDES.map((side) => {
          const text = side.key === "judge" ? trial.verdict.reasoning : trial[side.key].argument;
          const ids = side.key === "judge" ? trial.verdict.cited_events : trial[side.key].cited_events;
          const model = side.key === "judge" ? trial.judgeModel : trial[side.key].model;
          return (
            <article key={side.key} className="card flex flex-col gap-3 p-4" style={{ borderTop: `3px solid ${side.color}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[15px]">{side.label}</h2>
                <span className="text-[12px] text-c-soft">{model}</span>
              </div>
              <p className="m-0 text-[14px] leading-relaxed">{text}</p>
              {ids.length > 0 && (
                <span className="text-[13px] text-c-soft">Cites {ids.map((n) => `event ${n}`).join(", ")}</span>
              )}
            </article>
          );
        })}
      </section>

      <section className="card overflow-x-auto" aria-labelledby="ev-h">
        <h2 id="ev-h" className="px-4 pt-4 text-[15px]">Evidence the court saw</h2>
        <p className="m-0 px-4 text-[13px] text-c-soft">Arguments must cite events from the log, so the court rules on what happened, not on the worker&apos;s own account.</p>
        {window.length === 0 ? (
          <p className="m-0 p-4 text-c-soft">The events for this case aren&apos;t loaded.</p>
        ) : (
          <table className="data mt-2">
            <thead>
              <tr>
                <th>Event</th>
                <th>Step</th>
                <th>Action</th>
                <th>Tests</th>
                <th>Cost</th>
                <th>Cited by</th>
              </tr>
            </thead>
            <tbody>
              {window.map((e) => (
                <EvidenceRow key={e.id} event={e} citedBy={citedBy.get(e.id)} charged={trial.charge.eventIds.includes(e.id)} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-4" aria-labelledby="json-h">
        <div className="flex items-center justify-between gap-2">
          <h2 id="json-h" className="text-[15px]">Verdict sent to the worker</h2>
          <Link href={`/court/${trial.id}`} className="btn">Watch it in the courtroom</Link>
        </div>
        <pre className="m-0 whitespace-pre-wrap break-words rounded-md p-3 text-[12px] leading-relaxed" style={{ background: "var(--c-bg)", border: "1px solid var(--c-line)" }}>
          {JSON.stringify(trial.verdict, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-2 p-4 text-[14px]">
      <span className="text-[13px] text-c-soft">{label}</span>
      {children}
    </div>
  );
}

function EvidenceRow({ event: e, citedBy, charged }: { event: Event; citedBy?: string[]; charged: boolean }) {
  return (
    <tr style={{ background: citedBy ? "color-mix(in srgb, var(--gold) 6%, transparent)" : undefined }}>
      <td className="font-medium">#{e.id}</td>
      <td className="text-c-soft">{e.step}</td>
      <td className="max-w-[520px]">
        <span style={eventFailed(e) ? { color: "#ff8a9a" } : undefined}>{describeEvent(e)}</span>
        {e.error && <span className="block" style={{ color: "#ff8a9a" }}>{e.error}</span>}
      </td>
      <td>
        {e.testsPassing}/{e.testsTotal}
      </td>
      <td>{usd(e.costUsd)}</td>
      <td className="whitespace-nowrap text-c-soft">{[...(charged ? ["Monitor"] : []), ...(citedBy ?? [])].join(", ")}</td>
    </tr>
  );
}
