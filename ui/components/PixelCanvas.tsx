"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  width: number;
  height: number;
  render: (ctx: CanvasRenderingContext2D, tick: number) => void;
  // Fixed whole-number scale. Without it, the canvas takes the largest whole scale that fits its container.
  scale?: number;
  maxScale?: number;
  animate?: boolean;
  fps?: number;
  label?: string;
  className?: string;
};

// Draws pixel art at native size and scales it up by whole numbers only (ART.md, "The pixel grid").
export function PixelCanvas({ width, height, render, scale, maxScale = 8, animate = false, fps = 12, label, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef(render);
  const [fit, setFit] = useState(scale ?? 1);

  useEffect(() => {
    renderRef.current = render;
    if (!animate) {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        render(ctx, 0);
      }
    }
  }, [render, animate, width, height]);

  useEffect(() => {
    if (scale) return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setFit(Math.max(1, Math.min(maxScale, Math.floor(entry.contentRect.width / width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale, width, maxScale]);

  useEffect(() => {
    if (!animate) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = -1;
    const start = performance.now();
    const loop = (now: number) => {
      const tick = still ? 0 : Math.floor(((now - start) / 1000) * fps);
      if (tick !== last) {
        last = tick;
        ctx.clearRect(0, 0, width, height);
        renderRef.current(ctx, tick);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate, fps, width, height]);

  const s = scale ?? fit;
  return (
    <div ref={wrapRef} className={className} style={scale ? { width: width * s } : { width: "100%" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="pixelated mx-auto"
        style={{ width: width * s, height: height * s }}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    </div>
  );
}
