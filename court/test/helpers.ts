import { readFileSync } from "node:fs";
import type { Charge, Event } from "../src/types.ts";

export type Fixture = { budgetUsd: number; events: Event[]; charge: Charge };

export function loadFixture(): Fixture {
  return JSON.parse(readFileSync(new URL("../fixtures/looping-run.json", import.meta.url), "utf8"));
}

// Engine-style event: failures live in `result`, run_tests args are {}.
export function ev(id: number, tool: string, args: Record<string, unknown>, extra: Partial<Event> = {}): Event {
  return {
    id,
    workerId: "w",
    step: id,
    tool,
    args,
    tokens: 100,
    costUsd: 0.01,
    testsPassing: 5,
    testsTotal: 10,
    timestamp: `2026-10-24T22:00:${String(id).padStart(2, "0")}Z`,
    ...extra,
  };
}
