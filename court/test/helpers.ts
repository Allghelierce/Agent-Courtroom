import { readFileSync } from "node:fs";
import type { Charge, Event } from "../src/types.ts";

export type Fixture = { budgetUsd: number; events: Event[]; charge: Charge };

export function loadFixture(): Fixture {
  return JSON.parse(readFileSync(new URL("../fixtures/looping-run.json", import.meta.url), "utf8"));
}
