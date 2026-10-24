// Run one trial from a fixture and print the transcript.
//   npm run trial -- fixtures/looping-run.json [--save cases] [--mock]
import { readFile } from "node:fs/promises";
import { saveTrial } from "./caselog.ts";
import { holdTrial } from "./court.ts";
import { buildPacket } from "./packet.ts";
import type { Charge, Event } from "./types.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "fixtures/looping-run.json";
const saveDir = args.includes("--save") ? (args[args.indexOf("--save") + 1] ?? "cases") : undefined;

const run = JSON.parse(await readFile(file, "utf8")) as { budgetUsd: number; events: Event[]; charge: Charge };
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });
const trial = await holdTrial(packet, { mock: args.includes("--mock") ? true : undefined });

console.log(`CASE ${trial.id}${trial.mock ? " (mock court: no API key set)" : ""}`);
console.log(`CHARGE: ${trial.charge.kind} — ${trial.charge.summary}\n`);
console.log(`PROSECUTOR (${trial.prosecution.model}): ${trial.prosecution.argument}\n  cites ${trial.prosecution.cited_events.join(", ")}\n`);
console.log(`DEFENSE (${trial.defense.model}): ${trial.defense.argument}\n  cites ${trial.defense.cited_events.join(", ")}\n`);
console.log(`JUDGE (${trial.judgeModel}): ${trial.verdict.ruling.toUpperCase()}`);
if (trial.verdict.instruction) console.log(`  instruction: ${trial.verdict.instruction}`);
console.log(`  reasoning: ${trial.verdict.reasoning}\n  cites ${trial.verdict.cited_events.join(", ")}`);
console.log(`\nCourt cost: $${trial.costUsd.toFixed(4)}`);
if (saveDir) console.log(`Saved to ${await saveTrial(trial, saveDir)}`);
