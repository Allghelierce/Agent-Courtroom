"use client";

import Link from "next/link";
import { RulingChip } from "@/components/Console";
import { KIND_LABEL, usd } from "@/lib/data";
import { useLive } from "@/lib/live";

export default function Cases() {
  const { caseLog, courtUp, source } = useLive();
  const newest = caseLog.toReversed();
  const from = source === "live" ? "From the engine" : courtUp ? "From the court server" : "Recorded demo cases";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px]">Cases</h1>
          <p className="m-0 text-c-soft">Every trial the court has held, newest first. Each one is a readable record of why a worker was stopped, redirected or cleared.</p>
        </div>
        <span className="text-[13px] text-c-soft">{from}</span>
      </div>

      <section className="card overflow-x-auto">
        {newest.length === 0 ? (
          <p className="m-0 p-4 text-c-soft">No trials yet. Court convenes when a monitor flags a worker.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Case</th>
                <th>Worker</th>
                <th>Charge</th>
                <th>Ruling</th>
                <th>Judge&apos;s reasoning</th>
                <th>Court cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {newest.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-c-soft">{t.id}</td>
                  <td className="font-medium">{t.workerId}</td>
                  <td>{KIND_LABEL[t.charge.kind]}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <RulingChip ruling={t.verdict.ruling} />
                      {t.summary && <span className="text-[12px] text-c-soft">summary judgment</span>}
                    </span>
                  </td>
                  <td className="max-w-[420px]">
                    <span className="line-clamp-2 text-c-soft">{t.verdict.reasoning}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {usd(t.costUsd)}
                    {t.mock ? " (mock)" : ""}
                  </td>
                  <td>
                    <span className="flex justify-end gap-2">
                      <Link href={`/court/${t.id}?view=record`} className="btn">Record</Link>
                      <Link href={`/court/${t.id}`} className="btn">Replay</Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
