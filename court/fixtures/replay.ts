// Replays a recorded stream (one StreamMessage per line) with its original timing.
// Works on stream-demo-4workers.jsonl and on shared/samples/*.jsonl from the engine.
// Stand-in for a live server: the engine's GET /stream (Person C's event server) replaces this.
//
//   npx tsx fixtures/replay.ts [file.jsonl] [--speed N] [--sse]
//
// Prints each message as one JSON line, or as `data: <json>\n\n` with --sse.

import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Charge, Event, Verdict } from "../src/types.ts";

// Mirrors the StreamMessage union in shared/schema.ts (origin/Amelia).
export type WorkerStatus = {
  workerId: string;
  state: "running" | "on_trial" | "awaiting_human" | "succeeded" | "halted" | "failed";
  task: string;
  courtEnabled: boolean;
  step: number;
  testsPassing: number;
  testsTotal: number;
  costUsd: number;
  budgetUsd: number;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  seconds?: number; // set on comparison entries
};

export type StreamMessage =
  | { type: "worker"; data: WorkerStatus }
  | { type: "event"; data: Event }
  | { type: "charge"; data: Charge }
  | { type: "verdict"; data: { workerId: string; chargeId: number; verdict: Verdict } }
  | { type: "comparison"; data: { withCourt: WorkerStatus; withoutCourt: WorkerStatus } };

export const DEMO_PATH = fileURLToPath(new URL("./stream-demo-4workers.jsonl", import.meta.url));

// Only events and a worker's start/end carry a time. Every other message
// happens at the time of the line before it.
export function messageTime(msg: StreamMessage): number | undefined {
  if (msg.type === "event") return Date.parse(msg.data.timestamp);
  if (msg.type === "worker") {
    if (msg.data.endedAt) return Date.parse(msg.data.endedAt);
    if (msg.data.step === 0) return Date.parse(msg.data.startedAt);
  }
  return undefined;
}

export async function loadStream(path: string = DEMO_PATH): Promise<StreamMessage[]> {
  const text = await readFile(path, "utf8");
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as StreamMessage);
}

// Calls onMessage for each line, waiting the original gap between lines
// divided by speed. Resolves early (without throwing) when signal aborts.
export async function replay(
  path: string,
  opts: { speed?: number; signal?: AbortSignal },
  onMessage: (msg: StreamMessage) => void,
): Promise<void> {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const messages = await loadStream(path);
  let last: number | undefined;
  for (const msg of messages) {
    if (opts.signal?.aborted) return;
    const t = messageTime(msg) ?? last;
    if (t !== undefined && last !== undefined && t > last) {
      try {
        await sleep((t - last) / speed, undefined, { signal: opts.signal });
      } catch {
        return; // aborted
      }
    }
    if (t !== undefined) last = t;
    onMessage(msg);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const speedAt = args.indexOf("--speed");
  const speed = speedAt >= 0 ? Number(args[speedAt + 1]) : 1;
  const sse = args.includes("--sse");
  const path = args.find((a, i) => !a.startsWith("--") && i !== speedAt + 1) ?? DEMO_PATH;
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.stdout.on("error", () => controller.abort()); // e.g. EPIPE when piped into `head`
  void replay(path, { speed, signal: controller.signal }, (msg) => {
    process.stdout.write(sse ? `data: ${JSON.stringify(msg)}\n\n` : `${JSON.stringify(msg)}\n`);
  });
}
