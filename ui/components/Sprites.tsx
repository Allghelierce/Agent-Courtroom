"use client";

import { useCallback, useMemo } from "react";
import { BUST, CHIBI_H, CHIBI_W, chibi, portrait, type CastKey, type Mood } from "@/lib/sprites";
import { PixelCanvas } from "./PixelCanvas";

export function Chibi({ who, mood = "neutral", scale = 3, label }: { who: Exclude<CastKey, "clerk">; mood?: Mood; scale?: number; label?: string }) {
  const art = useMemo(() => chibi(who, mood), [who, mood]);
  const render = useCallback((ctx: CanvasRenderingContext2D) => art.draw(ctx), [art]);
  return <PixelCanvas width={CHIBI_W} height={CHIBI_H} scale={scale} render={render} label={label} />;
}

export function Portrait({ who, mood = "neutral", scale = 3 }: { who: CastKey; mood?: Mood; scale?: number }) {
  const art = useMemo(() => portrait(who, mood), [who, mood]);
  const render = useCallback((ctx: CanvasRenderingContext2D) => art.draw(ctx), [art]);
  return <PixelCanvas width={BUST} height={BUST} scale={scale} render={render} />;
}
