"use client";

import Link from "next/link";
import { RulingTag } from "@/components/Pieces";
import { KIND_LABEL, clock, repoFor, useCourtData, usd } from "@/lib/data";

export default function CaseLog() {
  const { trials, source } = useCourtData();
  const newest = trials.toReversed();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px]">Case log</h1>
          <p className="m-0">Every trial the court has held, newest first. Open one to replay it.</p>
        </div>
        <span className="text-sm text-soft">{source === "live" ? "Live from the engine" : source === "disconnected" ? "Disconnected — showing last received data" : "Demo fixtures (engine offline)"}</span>
      </div>

      {newest.length === 0 ? (
        <p className="px-box p-6">No trials yet. Court convenes when a monitor flags a worker.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {newest.map((t) => (
            <li key={t.id} className="px-box grid gap-4 p-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-center">
              <div className="flex flex-col gap-1">
                <span className="font-display text-[20px] leading-none">{t.workerId}</span>
                <span className="text-sm text-soft">{repoFor(t.workerId)} · {clock(t.finishedAt)}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="m-0">
                  <span className="font-display">{KIND_LABEL[t.charge.kind]}:</span> {t.charge.summary}
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-soft">What each side said</summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <Said who="Prosecution" color="var(--red)" text={t.prosecution.argument} />
                    <Said who="Defense" color="var(--blue)" text={t.defense.argument} />
                    <Said who="Judge" color="var(--gold)" text={t.verdict.instruction ? `${t.verdict.reasoning} ${t.verdict.instruction}` : t.verdict.reasoning} />
                  </div>
                </details>
              </div>
              <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-end">
                <RulingTag ruling={t.verdict.ruling} />
                <span className="text-sm text-soft">Court cost {usd(t.costUsd)}</span>
                <Link href={`/court/${t.id}`} className="px-btn ghost">Replay the trial</Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Said({ who, color, text }: { who: string; color: string; text: string }) {
  return (
    <div className="px-inset flex flex-col gap-1 p-3" style={{ borderLeftColor: color, borderLeftWidth: 8 }}>
      <span className="font-display">{who}</span>
      <span>{text}</span>
    </div>
  );
}
