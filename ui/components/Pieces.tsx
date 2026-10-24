import { STATE_COLOR, STATE_LABEL } from "@/lib/data";
import type { WorkerState } from "@/lib/stream";

export function StatusTag({ state }: { state: WorkerState }) {
  return (
    <span className={`px-tag ${state === "on_trial" ? "pulse-step" : ""}`} style={{ background: STATE_COLOR[state], color: "var(--on-accent)" }}>
      {STATE_LABEL[state]}
    </span>
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
