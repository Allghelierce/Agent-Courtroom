"use client";

import { useCallback, useRef } from "react";
import { CHIBI_W, SCENE_H, SCENE_W, STAGE, chibi, gavel, sceneBack, sceneBench, sceneFront, type CastKey, type Mood } from "@/lib/sprites";
import { PixelCanvas } from "./PixelCanvas";

type Actor = Exclude<CastKey, "clerk">;
type Props = {
  speaker: CastKey | null;
  moods?: Partial<Record<Actor, Mood>>;
  swirl?: boolean; // the looping worker's orbiting dots
  gavelDown?: boolean;
  workerLabel?: string;
  maxScale?: number;
};

const ACTORS: Actor[] = ["judge", "pros", "def", "worker"]; // for the mood cache key
const GOLD = "#f7c948";
const INK = "#120c22";

export function CourtScene({ speaker, moods = {}, swirl = false, gavelDown = false, workerLabel = "a worker", maxScale = 6 }: Props) {
  // Static layers and sprites are built once per mood on the client and reused every frame.
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const gavelHit = useRef<number | null>(null); // the tick the gavel came down, for its sparks
  const layer = (key: string, make: () => { toCanvas(): HTMLCanvasElement }) => {
    let cv = cache.current.get(key);
    if (!cv) {
      cv = make().toCanvas();
      cache.current.set(key, cv);
    }
    return cv;
  };

  const moodKey = ACTORS.map((a) => moods[a] ?? "neutral").join(",");
  const render = useCallback(
    (ctx: CanvasRenderingContext2D, tick: number) => {
      ctx.drawImage(layer("back", sceneBack), 0, 0);

      // petals drifting past the windows
      for (let i = 0; i < 12; i++) {
        const x = (i * 41 + tick * (1 + (i % 3))) % SCENE_W;
        const y = (i * 19 + tick * 2) % 70;
        ctx.fillStyle = "#ffb7d5";
        ctx.fillRect(x, y, 2, 1);
        ctx.fillStyle = "#ff8fbf";
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }

      const actor = (who: Actor) => {
        const mood = moods[who] ?? "neutral";
        const bob = who === speaker && tick % 4 < 2 ? -1 : 0;
        const { x, y } = STAGE[who];
        ctx.drawImage(layer(`${who}:${mood}`, () => chibi(who, mood)), x, y + bob);
      };

      // Back to front: the Judge, the bench and gavel, the lawyers and worker, then their desks and the stand.
      actor("judge");
      ctx.drawImage(layer("bench", sceneBench), 0, 0);
      const up = speaker === "judge" && !gavelDown && tick % 6 < 3;
      ctx.drawImage(layer(up ? "gavel-up" : "gavel-down", () => gavel(up)), 150, 36);

      // sparks flying off the bench for half a second after the gavel lands
      if (!gavelDown) gavelHit.current = null;
      else if (gavelHit.current === null || tick < gavelHit.current) gavelHit.current = tick;
      const since = gavelDown && gavelHit.current !== null ? tick - gavelHit.current : -1;
      if (since >= 0 && since < 6) {
        const d = 2 + since * 2;
        ctx.fillStyle = since < 3 ? "#ffffff" : GOLD;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [0, -1]]) ctx.fillRect(154 + dx * d, 40 + dy * d, 2, 2);
      }
      actor("pros");
      actor("def");
      actor("worker");
      ctx.drawImage(layer("front", sceneFront), 0, 0);

      // speech arrow over whoever is talking
      if (speaker && speaker !== "clerk") {
        const { x, y } = STAGE[speaker];
        const cx = x + Math.floor(CHIBI_W / 2) - 3;
        const ay = y - 6 + (tick % 4 < 2 ? 0 : 1);
        ctx.fillStyle = INK;
        ctx.fillRect(cx - 1, ay - 1, 8, 1);
        ctx.fillStyle = GOLD;
        for (let r = 0; r < 4; r++) ctx.fillRect(cx + r, ay + r, 6 - r * 2, 1);
      }

      if (swirl) {
        const { x, y } = STAGE.worker;
        const cx = x + CHIBI_W / 2;
        const cy = y - 1;
        const pts = [[0, -3], [3, 0], [0, 3], [-3, 0]];
        pts.forEach(([dx, dy], i) => {
          ctx.fillStyle = i === tick % 4 ? "#ffb347" : "#7a5a2a";
          ctx.fillRect(cx + dx - 1, cy + dy - 1, 2, 2);
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speaker, moodKey, swirl, gavelDown],
  );

  return (
    <PixelCanvas
      width={SCENE_W}
      height={SCENE_H}
      render={render}
      animate
      maxScale={maxScale}
      label={`Pixel-art courtroom: Judge Haku at the bench, Prosecutor Aka on the left, Defense Aoi on the right, and ${workerLabel} on the witness stand`}
    />
  );
}
