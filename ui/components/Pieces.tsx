import type { ChargeKind, Ruling } from "@court/types";
import { KIND_LABEL, RULING_COLOR, RULING_LABEL, STATUS_COLOR, STATUS_LABEL, type WorkerStatus } from "@/lib/data";

export function StatusTag({ status }: { status: WorkerStatus }) {
  const light = status === "halted" || status === "needs_human";
  return (
    <span className={`px-tag ${status === "on_trial" ? "pulse-step" : ""}`} style={{ background: STATUS_COLOR[status], color: light ? "var(--paper)" : "var(--ink)" }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function RulingTag({ ruling }: { ruling: Ruling }) {
  const light = ruling === "halt" || ruling === "escalate";
  return (
    <span className="px-tag" style={{ background: RULING_COLOR[ruling], color: light ? "var(--paper)" : "var(--ink)" }}>
      {RULING_LABEL[ruling]}
    </span>
  );
}

// Segmented meter: one cell per unit, never a smooth bar (ART.md, "Shapes and surfaces").
export function Meter({ value, max, cells = max, color, label }: { value: number; max: number; cells?: number; color: string; label: string }) {
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * cells) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="flex gap-1">
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className="h-3 flex-1 border-2 border-ink" style={{ background: i < filled ? color : "var(--blush)" }} />
      ))}
    </div>
  );
}

const LIGHTS: { kind: ChargeKind; color: string }[] = [
  { kind: "looping", color: "var(--berry)" },
  { kind: "stalling", color: "var(--gold)" },
  { kind: "overspending", color: "var(--berry)" },
  { kind: "flailing", color: "var(--gold)" },
];

export function WarningLights({ lit }: { lit: ChargeKind[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="Warning lights">
      {LIGHTS.map(({ kind, color }) => {
        const on = lit.includes(kind);
        return (
          <li key={kind} className="flex items-center gap-2 text-sm" style={{ color: on ? "var(--ink)" : "var(--ink-soft)" }}>
            <span
              aria-hidden
              className="inline-block size-3 border-2 border-ink"
              style={on ? { background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 40%, transparent)` } : undefined}
            />
            {KIND_LABEL[kind]}
            <span className="sr-only">{on ? "(lit)" : "(off)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

// 8x8 pixel icons, drawn as SVG rects so they stay crisp at any whole scale.
const ICONS: Record<string, string[]> = {
  gavel: ["..####..", "..####..", "..####..", "...##...", "...##...", "...##...", "########", "########"],
  scroll: ["########", "#......#", "#.####.#", "#......#", "#.###..#", "#......#", "#.####.#", "########"],
  grid: ["###.###.", "###.###.", "###.###.", "........", "###.###.", "###.###.", "###.###.", "........"],
};

export function PixelIcon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  const rows = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden fill="currentColor">
      {rows.flatMap((row, y) => [...row].map((ch, x) => (ch === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  );
}
