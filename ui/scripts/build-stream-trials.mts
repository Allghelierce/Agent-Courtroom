// Builds the UI's demo data from the court's 4-worker stream:
//   data/stream-demo.json    the StreamMessages, one array (the UI replays it in the browser)
//   data/stream-trials.json  a full mock Trial for every charge in the stream
//
// A stream verdict carries only the ruling, so each trial is held by the court's own code in mock mode
// on the events before the charge, then given the stream's verdict, which is what the worker acted on.
// Run from ../court so tsx resolves the court's modules:  npm run sync-data
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPacket, holdTrial, type Charge, type Event, type Trial } from "../../court/src/index.ts";
import type { StreamMessage } from "../../court/fixtures/replay.ts";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..");
const streamPath = join(ui, "..", "court", "fixtures", "stream-demo-4workers.jsonl");

const lines = (await readFile(streamPath, "utf8")).split("\n").filter((l) => l.trim());
const messages = lines.map((l) => JSON.parse(l) as StreamMessage);

const events: Event[] = [];
const budgets = new Map<string, number>();
const charges = new Map<string, { charge: Charge; seen: Event[] }>();
const trials: Trial[] = [];

for (const msg of messages) {
  if (msg.type === "worker") budgets.set(msg.data.workerId, msg.data.budgetUsd);
  if (msg.type === "event") events.push(msg.data);
  if (msg.type === "charge") charges.set(`${msg.data.workerId}:${msg.data.id}`, { charge: msg.data, seen: [...events] });
  if (msg.type === "verdict") {
    const { workerId, chargeId, verdict } = msg.data;
    const filed = charges.get(`${workerId}:${chargeId}`);
    if (!filed) throw new Error(`verdict for unknown charge ${workerId}:${chargeId}`);
    const packet = buildPacket(filed.charge, filed.seen, { budgetUsd: budgets.get(workerId) ?? 1 });
    const trial = await holdTrial(packet, { mock: true });
    trials.push({ ...trial, id: `demo-${workerId}-${chargeId}`, verdict });
  }
}

await writeFile(join(ui, "data", "stream-demo.json"), `${JSON.stringify(messages)}\n`);
await writeFile(join(ui, "data", "stream-trials.json"), `${JSON.stringify(trials, null, 2)}\n`);
console.log(`stream: ${messages.length} messages, ${trials.length} trials`);
