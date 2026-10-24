// Tiny HTTP front door to the court, so the engine and the UI can reach it
// before it's wired into Person C's event server.
//   npm run serve                 (port from COURT_PORT, default 4100)
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTrials, saveTrial } from "./caselog.ts";
import { holdTrial } from "./court.ts";
import { buildPacket, fromEnginePacket } from "./packet.ts";
import type { Charge, EnginePacket, Event, Trial, Verdict } from "./types.ts";

const PORT = Number(process.env.COURT_PORT ?? 4100);
const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "cases");
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Case-Id, X-Precedents",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...CORS, ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) });
  res.end(body === undefined ? undefined : `${JSON.stringify(body)}\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

async function convene(req: IncomingMessage): Promise<Trial> {
  const body = (await readJson(req)) as { charge?: Charge; events?: Event[]; budgetUsd?: number } | null;
  if (!body?.charge || typeof body.charge !== "object") throw new HttpError(400, "missing charge");
  if (!Array.isArray(body.events)) throw new HttpError(400, "events must be an array");
  if (typeof body.budgetUsd !== "number") throw new HttpError(400, "budgetUsd must be a number");

  const packet = buildPacket(body.charge, body.events, { budgetUsd: body.budgetUsd });
  const trial = await holdTrial(packet, { past: await listTrials(CASES_DIR) });
  await saveTrial(trial, CASES_DIR);
  return trial;
}

// The engine's contract (shared/schema.ts): POST an EvidencePacket, get a bare Verdict back.
async function verdict(req: IncomingMessage): Promise<{ verdict: Verdict; caseId: string; precedents: string[] }> {
  const body = (await readJson(req)) as Partial<EnginePacket> | null;
  if (!body?.charge || typeof body.charge !== "object") throw new HttpError(400, "missing charge");
  if (!Array.isArray(body.events)) throw new HttpError(400, "events must be an array");
  if (!Array.isArray(body.testProgress)) throw new HttpError(400, "testProgress must be an array");
  if (typeof body.spend?.costUsd !== "number" || typeof body.spend?.budgetUsd !== "number") {
    throw new HttpError(400, "spend must be {costUsd, budgetUsd} numbers");
  }
  if (typeof body.task !== "string") throw new HttpError(400, "task must be a string");

  // The court learns from its own case log: similar past trials go to the Judge as precedent.
  const trial = await holdTrial(fromEnginePacket(body as EnginePacket), { past: await listTrials(CASES_DIR) });
  await saveTrial(trial, CASES_DIR);
  return { verdict: trial.verdict, caseId: trial.id, precedents: trial.precedents ?? [] };
}

async function getTrial(id: string): Promise<Trial> {
  // Trial IDs become filenames, so reject anything that could escape CASES_DIR.
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, "invalid case id");
  try {
    return JSON.parse(await readFile(join(CASES_DIR, `${id}.json`), "utf8")) as Trial;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `no case ${id}`);
    throw err;
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const caseId = pathname.match(/^\/cases\/([^/]+)$/)?.[1];
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    if (req.method === "GET" && pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && pathname === "/convene") return send(res, 200, await convene(req));
    if (req.method === "POST" && pathname === "/verdict") {
      const { verdict: v, caseId: id, precedents } = await verdict(req);
      return send(res, 200, v, { "X-Case-Id": id, "X-Precedents": precedents.join(",") });
    }
    if (req.method === "GET" && pathname === "/cases") return send(res, 200, await listTrials(CASES_DIR));
    if (req.method === "GET" && caseId) return send(res, 200, await getTrial(decodeURIComponent(caseId)));
    send(res, 404, { error: `no route ${req.method} ${pathname}` });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => console.log(`court listening on http://localhost:${PORT}`));
