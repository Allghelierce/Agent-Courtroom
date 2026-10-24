import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildPacket } from "../src/packet.ts";
import { holdTrial } from "../src/court.ts";
import type { Ruling } from "../src/types.ts";
import type { Fixture } from "./helpers.ts";

const dir = new URL("../fixtures/", import.meta.url);
const RULINGS = ["continue", "change_strategy", "escalate", "halt"];

// A fixture's verdict.expected reads "<ruling> or <ruling>: why"; the rulings before the colon are acceptable.
// Without a note, the fixture's own verdict.ruling is the only acceptable ruling.
function acceptable(note: string): Ruling[] {
  const head = note.split(":")[0];
  const rulings = head.split(/\s+or\s+/).map((r) => r.trim());
  for (const r of rulings) assert.ok(RULINGS.includes(r), `unknown ruling "${r}" in expected note`);
  return rulings as Ruling[];
}

for (const file of readdirSync(dir).filter((f) => f.endsWith("-run.json")).sort()) {
  const fx = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Fixture & { verdict?: { ruling?: Ruling; expected?: string } };
  const note = fx.verdict?.expected ?? fx.verdict?.ruling;

  test(`${file}: mock court ruling matches the expected note`, { skip: note ? false : "no expected verdict" }, async () => {
    const packet = buildPacket(fx.charge, fx.events, { budgetUsd: fx.budgetUsd });
    const trial = await holdTrial(packet, { mock: true });
    const ok = acceptable(note!);
    assert.ok(ok.includes(trial.verdict.ruling), `got ${trial.verdict.ruling}, expected ${ok.join(" or ")}. Note: ${note}`);
    const ids = new Set(packet.events.map((e) => e.id));
    for (const id of trial.verdict.cited_events) assert.ok(ids.has(id), `cited event ${id} is not in the packet`);
  });
}
