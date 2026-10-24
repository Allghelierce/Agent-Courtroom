import type { ChargeKind, Event, Ruling } from "@court/types";
import { KIND_LABEL, RULING_COLOR, RULING_LABEL, STATE_COLOR, STATE_LABEL } from "@/lib/data";
import type { WorkerState } from "@/lib/stream";

// Console pieces: the serious side of the UI (ART.md, "Two modes"). Flat, hairline, colour only where it means something.

export function StateChip({ state }: { state: WorkerState }) {
  return (
    <span className={`chip ${state === "on_trial" ? "pulse-soft" : ""}`} style={{ "--chip": STATE_COLOR[state] } as React.CSSProperties}>
      {STATE_LABEL[state]}
    </span>
  );
}

export function RulingChip({ ruling }: { ruling: Ruling }) {
  return (
    <span className="chip" style={{ "--chip": RULING_COLOR[ruling] } as React.CSSProperties}>
      {RULING_LABEL[ruling]}
    </span>
  );
}

// A thin progress bar; turns red past the warn fraction.
export function Bar({ value, max, color, warnAt, label }: { value: number; max: number; color: string; warnAt?: number; label: string }) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const fill = warnAt !== undefined && frac >= warnAt ? "var(--red)" : color;
  return (
    <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--c-line)" }}>
      <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: fill }} />
    </div>
  );
}

// Tests passing over the worker's steps, as a step line.
export function Sparkline({ events, total, width = 96, height = 24 }: { events: Event[]; total: number; width?: number; height?: number }) {
  if (events.length < 2 || total === 0) return <svg width={width} height={height} aria-hidden />;
  const x = (i: number) => (i / (events.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - (v / total) * (height - 2);
  let d = `M ${x(0)} ${y(events[0].testsPassing)}`;
  events.forEach((e, i) => {
    if (i === 0) return;
    d += ` H ${x(i)} V ${y(e.testsPassing)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <line x1="0" x2={width} y1={y(total)} y2={y(total)} stroke="var(--c-line)" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="var(--green)" strokeWidth="1.5" />
    </svg>
  );
}

// The four monitors, as the engine runs them (engine/courtroom_engine/monitors.py, MonitorConfig defaults).
export const MONITORS: { kind: ChargeKind; rule: string }[] = [
  { kind: "looping", rule: "The same action with the same result 3 times within 10 steps" },
  { kind: "stalling", rule: "No newly passing test in 8 steps" },
  { kind: "overspending", rule: "80% of the budget spent, or over $0.50 with no newly passing test" },
  { kind: "flailing", rule: "3 tool errors in a row, or the same error 3 times" },
];

export function MonitorDots({ lit }: { lit: ChargeKind[] }) {
  return (
    <span className="inline-flex gap-1.5" aria-label={lit.length ? `Flagged: ${lit.map((k) => KIND_LABEL[k]).join(", ")}` : "No monitor flags"}>
      {MONITORS.map(({ kind }) => {
        const on = lit.includes(kind);
        return <span key={kind} title={KIND_LABEL[kind]} className="size-2 rounded-[2px]" style={{ background: on ? "var(--red)" : "var(--c-line)" }} />;
      })}
    </span>
  );
}
