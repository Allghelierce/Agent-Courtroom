// The courtroom's local server for Claude Code. One worker per Claude Code session:
// hooks POST each tool call to /hook, the monitors check it, and when one fires the
// court holds a trial and the hook hands the ruling back to Claude. The dashboard
// reads the same /stream, /cases and /resolve endpoints the engine serves.

import "./setup-env.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPacket, holdTrial, listTrials, saveTrial, type Charge, type Event, type Trial, type Verdict } from "../../court/src/index.ts";
import { TranscriptMeter, type PriceList } from "./cost.ts";
import { mapToolCall, type HookToolInput } from "./map.ts";
import { check, SESSION_CONFIG } from "./monitors.ts";

type WorkerState = "running" | "on_trial" | "awaiting_human" | "succeeded" | "halted" | "failed";
type WorkerStatus = {
  workerId: string;
  state: WorkerState;
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
  courtCostUsd?: number;
  courtCostComplete?: boolean;
  workerCostComplete?: boolean;
  costMode?: "simulated" | "estimated_from_usage";
};
type StreamMessage = { type: string; data: unknown; sequence?: number };

export type HookInput = HookToolInput & {
  session_id: string;
  transcript_path?: string;
  hook_event_name?: string;
  prompt?: string;
  source?: string;
};

type Worker = {
  sessionId: string;
  status: WorkerStatus;
  events: Event[];
  windowStart: number; // monitors only see events after the last ruling
  meter: TranscriptMeter;
  queue: Promise<unknown>; // one tool call at a time per session
  lastCaseId?: string;
  lastCharge?: Charge;
  lastVerdict?: Verdict;
  pendingOrder?: string; // a dashboard decision, delivered on the next prompt or tool call
  taskFromPrompt: boolean;
};

export type DaemonOptions = {
  port?: number;
  home?: string;
  budgetUsd?: number;
  dashboardUrl?: string;
  packetEvents?: number;
  mock?: boolean; // force the mock court (tests)
};

const PACKET_EVENTS = 20; // as engine/courtroom_engine/court.py

const now = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const KIND: Record<string, string> = { looping: "looping", stalling: "stalling", overspending: "overspending", flailing: "flailing" };

function loadPrices(): PriceList {
  try {
    const path = process.env.COURT_PRICES_PATH ?? fileURLToPath(new URL("../../shared/model-prices.json", import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")) as PriceList;
  } catch {
    return { models: {} };
  }
}

export function createDaemon(opts: DaemonOptions = {}) {
  const port = opts.port ?? Number(process.env.COURTROOM_PORT || 4300);
  const home = opts.home ?? process.env.COURTROOM_HOME ?? join(homedir(), ".claude-courtroom");
  const casesDir = join(home, "cases");
  const streamLog = join(home, "stream.jsonl");
  const budgetUsd = opts.budgetUsd ?? (Number(process.env.COURTROOM_BUDGET_USD) || 5);
  const dashboard = (opts.dashboardUrl ?? process.env.COURTROOM_DASHBOARD_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const packetEvents = opts.packetEvents ?? PACKET_EVENTS;
  const prices = loadPrices();
  mkdirSync(casesDir, { recursive: true });
  // Only the hook may post tool calls or stop the daemon: it reads this token from the file.
  const token = randomBytes(24).toString("hex");
  writeFileSync(join(home, "token"), token, { mode: 0o600 });
  // Browsers may read the stream (commands, paths) only from these origins.
  const allowedOrigins = (process.env.COURTROOM_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const originAllowed = (origin: string | undefined) =>
    !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) || allowedOrigins.includes(origin);

  const history: StreamMessage[] = [];
  const subscribers = new Set<ServerResponse>();
  const workers = new Map<string, Worker>(); // by session id
  let sequence = 0;
  let nextEventId = 1;
  let nextChargeId = 1;

  function publish(type: string, data: unknown, persist = true) {
    const msg: StreamMessage = { type, data, sequence: ++sequence };
    history.push(msg);
    if (persist) appendFileSync(streamLog, `${JSON.stringify(msg)}\n`);
    const frame = `id: ${msg.sequence}\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const res of subscribers) res.write(frame);
  }
  const publishStatus = (w: Worker) => publish("worker", { ...w.status });

  // Restore history from earlier runs of the daemon, so the dashboard keeps its past sessions.
  if (existsSync(streamLog)) {
    for (const line of readFileSync(streamLog, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as StreamMessage;
        history.push(msg);
        sequence = Math.max(sequence, msg.sequence ?? 0);
        const d = msg.data as { id?: number; chargeId?: number };
        if (msg.type === "event" && d.id) nextEventId = Math.max(nextEventId, d.id + 1);
        if (msg.type === "charge" && d.id) nextChargeId = Math.max(nextChargeId, d.id + 1);
      } catch {
        // a torn last line from a crash: skip it
      }
    }
  }

  const folderOf = (input: HookInput) => basename(input.cwd ?? "session") || "session";
  const workerIdOf = (input: HookInput) => `claude-code:${folderOf(input)}:${input.session_id.slice(0, 6)}`;

  function workerFor(input: HookInput): Worker {
    let w = workers.get(input.session_id);
    if (w) return w;
    const folder = folderOf(input);
    const workerId = workerIdOf(input);
    // A session seen before this daemon started: rebuild its events from the stream log.
    const prior = history.filter((m) => (m.data as { workerId?: string }).workerId === workerId);
    const lastStatus = [...prior].reverse().find((m) => m.type === "worker")?.data as WorkerStatus | undefined;
    const events = prior.filter((m) => m.type === "event").map((m) => m.data as Event);
    const lastRuling = prior.map((m, i) => (m.type === "verdict" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
    const windowStart = lastRuling < 0 ? 0 : prior.slice(0, lastRuling).filter((m) => m.type === "event").length;
    const meter = new TranscriptMeter(prices);
    if (lastStatus) meter.skipToEnd(input.transcript_path); // its usage is already counted
    w = {
      sessionId: input.session_id,
      status: lastStatus
        ? { ...lastStatus, state: lastStatus.state === "on_trial" ? "running" : lastStatus.state, endedAt: undefined }
        : {
            workerId,
            state: "running",
            task: `Claude Code session in ${folder}`,
            courtEnabled: true,
            step: 0,
            testsPassing: 0,
            testsTotal: 0,
            costUsd: 0,
            budgetUsd,
            startedAt: now(),
            courtCostUsd: 0,
            courtCostComplete: true,
            workerCostComplete: true,
            costMode: "estimated_from_usage",
          },
      events,
      windowStart,
      meter,
      queue: Promise.resolve(),
      taskFromPrompt: Boolean(lastStatus),
    };
    workers.set(input.session_id, w);
    publishStatus(w);
    return w;
  }

  function serial<T>(w: Worker, fn: () => Promise<T>): Promise<T> {
    const run = w.queue.then(fn, fn);
    w.queue = run.catch(() => undefined);
    return run;
  }

  // --- hook handlers: each returns the JSON object the hook prints (or undefined) ---

  function sessionStart(input: HookInput) {
    workerFor(input);
    return {
      systemMessage: `⚖ Courtroom is supervising this session. Trials appear at ${dashboard}`,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "This session is supervised by the Courtroom plugin. Cheap checks watch your tool calls for looping, stalling, flailing and overspending; when one fires, a court reviews the evidence. Messages marked COURT ORDER come from that court: follow them, they take priority over your current approach.",
      },
    };
  }

  function userPrompt(input: HookInput) {
    const w = workerFor(input);
    if (!w.taskFromPrompt && input.prompt) {
      w.status.task = clip(input.prompt.replace(/\s+/g, " ").trim(), 200);
      w.taskFromPrompt = true;
    }
    // The user answering in the terminal is the human decision the court asked for.
    if (w.status.state === "awaiting_human" || w.status.state === "halted") {
      w.status.state = "running";
      w.status.endedAt = undefined;
      w.windowStart = w.events.length;
    }
    publishStatus(w);
    const order = w.pendingOrder;
    w.pendingOrder = undefined;
    return order ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: order } } : undefined;
  }

  function preTool(input: HookInput) {
    const w = workers.get(input.session_id);
    if (!w) return undefined;
    const caseRef = w.lastCaseId ? ` (case ${w.lastCaseId})` : "";
    if (w.status.state === "awaiting_human") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `The Courtroom escalated this session to a human${caseRef}. Don't call more tools: explain the situation to the user and ask how to proceed.`,
        },
      };
    }
    if (w.status.state === "halted") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `The Courtroom halted this session${caseRef}: ${w.lastVerdict?.reasoning ?? "see the case log"}. Stop and summarize what happened for the user.`,
        },
      };
    }
    if (w.pendingOrder) {
      const order = w.pendingOrder;
      w.pendingOrder = undefined;
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: order } };
    }
    return undefined;
  }

  async function postTool(input: HookInput, eventName: "PostToolUse" | "PostToolUseFailure") {
    const w = workerFor(input);
    return serial(w, async () => {
      const m = mapToolCall(input);
      const usage = w.meter.read(input.transcript_path);
      const s = w.status;
      if (m.tests) [s.testsPassing, s.testsTotal] = [m.tests.passing, m.tests.total];
      s.step += 1;
      s.costUsd += usage.costUsd;
      if (!usage.priced) s.workerCostComplete = false;
      const event: Event = {
        id: nextEventId++,
        workerId: s.workerId,
        step: s.step,
        tool: m.tool,
        args: m.args,
        tokens: usage.tokens,
        costUsd: Number(usage.costUsd.toFixed(6)),
        testsPassing: s.testsPassing,
        testsTotal: s.testsTotal,
        ...(m.error ? { error: m.error } : {}),
        result: m.result,
        timestamp: now(),
      };
      w.events.push(event);
      publish("event", event);
      publishStatus(w);
      if (s.state !== "running" || !s.courtEnabled) return undefined;

      const finding = check(w.events.slice(w.windowStart), s.budgetUsd, SESSION_CONFIG);
      if (!finding) return undefined;
      return trial(w, { id: nextChargeId++, workerId: s.workerId, ...finding }, eventName);
    });
  }

  async function trial(w: Worker, charge: Charge, eventName: string) {
    publish("charge", charge);
    w.status.state = "on_trial";
    publishStatus(w);

    let t: Trial | null = null;
    let verdict: Verdict;
    try {
      const packet = buildPacket(charge, w.events, { budgetUsd: w.status.budgetUsd, window: packetEvents, task: w.status.task, runStartedAt: w.status.startedAt });
      t = await holdTrial(packet, { past: await listTrials(casesDir), ...(opts.mock !== undefined ? { mock: opts.mock } : {}) });
      await saveTrial(t, casesDir);
      verdict = t.verdict;
      w.status.courtCostUsd = (w.status.courtCostUsd ?? 0) + t.costUsd;
      if (t.costComplete === false) w.status.courtCostComplete = false;
      publish("trial", t);
    } catch (err) {
      // Same rule as the engine: no usable verdict means a human decides.
      verdict = { ruling: "escalate", reasoning: `The court could not rule (${(err as Error).message}).`, cited_events: charge.eventIds };
    }
    w.windowStart = w.events.length;
    w.lastCharge = charge;
    w.lastVerdict = verdict;
    w.lastCaseId = t?.id;
    publish("verdict", { workerId: w.status.workerId, chargeId: charge.id, verdict, ...(t ? { caseId: t.id } : {}) });
    return applyRuling(w, charge, verdict, t?.id, eventName);
  }

  function applyRuling(w: Worker, charge: Charge, v: Verdict, caseId: string | undefined, eventName: string) {
    const link = caseId ? `${dashboard}/court/${caseId}` : `${dashboard}/cases`;
    const kind = KIND[charge.kind] ?? charge.kind;
    const s = w.status;
    const toClaude = (text: string) => ({ hookEventName: eventName, additionalContext: text });
    switch (v.ruling) {
      case "continue":
        s.state = "running";
        publishStatus(w);
        return { systemMessage: `⚖ Courtroom: ${kind} charge dismissed, carry on. ${link}` };
      case "change_strategy":
        s.state = "running";
        publishStatus(w);
        return {
          systemMessage: `⚖ COURT ORDER (change strategy, ${kind} charge): ${v.instruction}\n  Trial: ${link}`,
          hookSpecificOutput: toClaude(
            `COURT ORDER from the Courtroom${caseId ? ` (case ${caseId})` : ""}, after a ${kind} charge: ${v.instruction}\nWhy: ${v.reasoning}\nFollow this order before anything else.`,
          ),
        };
      case "escalate":
        s.state = "awaiting_human";
        publishStatus(w);
        return {
          systemMessage: `⚖ Courtroom needs your decision (${kind} charge): ${v.reasoning}\n  Reply here, or decide in the dashboard: ${link}`,
          terminalSequence: "\u001b]9;Courtroom: a Claude Code session needs your decision\u0007",
          hookSpecificOutput: toClaude(
            `The Courtroom escalated this session to a human${caseId ? ` (case ${caseId})` : ""}: ${v.reasoning}${v.instruction ? `\nThe court suggests: ${v.instruction}` : ""}\nStop now. Don't call more tools; explain the situation to the user and ask how to proceed.`,
          ),
        };
      case "halt":
        s.state = "halted";
        s.endedAt = now();
        s.summary = `Halted by the court${caseId ? ` (case ${caseId})` : ""}: ${v.reasoning}`;
        publishStatus(w);
        return { continue: false, stopReason: `⚖ The Courtroom halted this session: ${v.reasoning} ${link}`, systemMessage: `⚖ Courtroom halted this session. ${link}` };
    }
  }

  function sessionEnd(input: HookInput) {
    // The daemon may have restarted mid-session: close out a session it only knows from the stream log too.
    const known = workers.has(input.session_id) || history.some((m) => m.type === "worker" && (m.data as WorkerStatus).workerId === workerIdOf(input));
    if (!known) return undefined;
    const w = workerFor(input);
    const s = w.status;
    if (s.state !== "halted") {
      const tested = s.testsTotal > 0;
      s.state = tested && s.testsPassing < s.testsTotal ? "failed" : "succeeded";
      s.summary = tested ? `Session ended at step ${s.step} with ${s.testsPassing}/${s.testsTotal} passing` : `Session ended at step ${s.step}`;
    }
    s.endedAt = now();
    publishStatus(w);
    workers.delete(input.session_id);
    return undefined;
  }

  async function handleHook(event: string, input: HookInput) {
    if (!input?.session_id) throw new Error("hook input needs a session_id");
    switch (event) {
      case "SessionStart":
        return sessionStart(input);
      case "UserPromptSubmit":
        return userPrompt(input);
      case "PreToolUse":
        return preTool(input);
      case "PostToolUse":
      case "PostToolUseFailure":
        return postTool(input, event);
      case "SessionEnd":
        return sessionEnd(input);
      default:
        return undefined;
    }
  }

  function resolve(workerId: string, body: Verdict): [number, unknown] {
    const w = [...workers.values()].find((x) => x.status.workerId === workerId);
    if (!w) return [404, { error: "no such worker" }];
    if (!body || !["continue", "change_strategy", "halt", "escalate"].includes(body.ruling)) return [400, { error: "invalid ruling" }];
    if (body.ruling === "escalate") return [400, { error: "a human has to pick continue, change_strategy, or halt" }];
    if (body.ruling === "change_strategy" && !body.instruction?.trim()) return [400, { error: "change_strategy needs an instruction" }];
    if (w.status.state !== "awaiting_human") return [409, { error: "worker is not awaiting a human" }];
    w.lastVerdict = body;
    if (w.lastCharge) publish("verdict", { workerId, chargeId: w.lastCharge.id, verdict: body, ...(w.lastCaseId ? { caseId: w.lastCaseId } : {}) });
    if (body.ruling === "halt") {
      w.status.state = "halted";
      w.status.endedAt = now();
      w.status.summary = "Halted by a human in the dashboard";
    } else {
      w.status.state = "running";
      w.windowStart = w.events.length;
      w.pendingOrder =
        body.ruling === "change_strategy"
          ? `COURT ORDER (decided by the user in the Courtroom dashboard): ${body.instruction}`
          : "The user reviewed the Courtroom's escalation in the dashboard and says: continue with your current approach.";
    }
    publishStatus(w);
    return [200, { workerId, state: w.status.state }];
  }

  // --- HTTP ---

  const cors = new WeakMap<ServerResponse, Record<string, string>>();
  function corsFor(origin: string | undefined): Record<string, string> {
    if (!origin || !originAllowed(origin)) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
      Vary: "Origin",
    };
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { ...cors.get(res), "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function body(req: IncomingMessage): Promise<unknown> {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  function stream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { ...cors.get(res), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders(); // open now, even with nothing to replay, so the dashboard sees the daemon is up
    const after = Number(req.headers["last-event-id"] ?? 0) || 0;
    for (const msg of history) if ((msg.sequence ?? 0) > after) res.write(`id: ${msg.sequence}\ndata: ${JSON.stringify(msg)}\n\n`);
    subscribers.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      subscribers.delete(res);
    });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/$/, "") || "/";
    const origin = req.headers.origin;
    cors.set(res, corsFor(origin));
    try {
      if (!originAllowed(origin)) return send(res, 403, { error: `origin ${origin} is not allowed (set COURTROOM_ALLOWED_ORIGINS)` });
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors.get(res));
        return res.end();
      }
      if (req.method === "GET") {
        if (path === "/health") return send(res, 200, { ok: true, service: "courtroom-plugin", workers: workers.size });
        if (path === "/stream") return stream(req, res);
        if (path === "/history") return send(res, 200, history);
        if (path === "/workers") return send(res, 200, [...workers.values()].map((w) => w.status));
        if (path === "/cases") return send(res, 200, await listTrials(casesDir));
        const caseId = path.match(/^\/cases\/([^/]+)$/)?.[1];
        if (caseId) {
          if (!/^[\w.-]+$/.test(caseId)) return send(res, 400, { error: "bad case id" });
          try {
            return send(res, 200, JSON.parse(await readFile(join(casesDir, `${caseId}.json`), "utf8")));
          } catch {
            return send(res, 404, { error: "no such case" });
          }
        }
      }
      if (req.method === "POST") {
        const authed = req.headers["x-courtroom-token"] === token;
        if (path === "/shutdown") {
          if (!authed) return send(res, 401, { error: "missing token" });
          send(res, 200, { ok: true });
          return void setTimeout(() => process.exit(0), 50);
        }
        if (path === "/hook") {
          if (!authed) return send(res, 401, { error: "missing token" });
          const b = (await body(req)) as { event: string; input: HookInput };
          return send(res, 200, { output: (await handleHook(b.event, b.input)) ?? null });
        }
        const resolveId = path.match(/^\/workers\/(.+)\/resolve$/)?.[1];
        if (resolveId) {
          const [status, out] = resolve(decodeURIComponent(resolveId), (await body(req)) as Verdict);
          return send(res, status, out);
        }
        if (path === "/runs" || path === "/compare") {
          return send(res, 501, { error: "This is the Claude Code courtroom: start a worker by opening Claude Code with the plugin installed." });
        }
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: (err as Error).message });
    }
  });

  return {
    server,
    port,
    home,
    handleHook,
    history,
    listen: () => new Promise<void>((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", () => ok())),
    close: () =>
      new Promise<void>((ok) => {
        for (const res of subscribers) res.end();
        server.close(() => ok());
      }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = createDaemon();
  d.listen().then(
    () => console.log(`courtroom: listening on http://127.0.0.1:${d.port} (data in ${d.home})`),
    (err) => {
      console.error(`courtroom: could not listen on ${d.port}: ${err.message}`);
      process.exit(1);
    },
  );
}
