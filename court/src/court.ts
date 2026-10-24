import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import Groq from "groq-sdk";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { envNum, envStr } from "./env.ts";
import { z } from "zod";
import { mockArgument, mockVerdict } from "./mock.ts";
import { findPrecedents, renderPrecedents } from "./precedent.ts";
import { rulesConfig, summaryArgument, summaryJudgment, type RulesConfig } from "./rules.ts";
import { DEFENSE_SYSTEM, JUDGE_SYSTEM, PROSECUTOR_SYSTEM, renderPacket } from "./prompts.ts";
import type { Argument, EvidencePacket, Side, Trial, Verdict } from "./types.ts";

// Which model API the court calls. Auto: Anthropic if its key is set, else Groq if
// GROQ_API_KEY is set, else the mock. COURT_PROVIDER=anthropic|groq forces one.
export type Provider = "anthropic" | "groq";

export function resolveProvider(): Provider | null {
  const forced = envStr("COURT_PROVIDER");
  if (forced === "anthropic" || forced === "groq") return forced;
  if (envStr("ANTHROPIC_API_KEY") || envStr("ANTHROPIC_AUTH_TOKEN")) return "anthropic";
  if (envStr("GROQ_API_KEY")) return "groq";
  return null;
}

const DEFAULT_MODELS: Record<Provider, { lawyer: string; judge: string }> = {
  anthropic: { lawyer: "claude-haiku-5-5", judge: "claude-opus-5-5" },
  groq: { lawyer: "openai/gpt-oss-20b", judge: "openai/gpt-oss-120b" },
};

export function modelsFor(provider: Provider): { lawyer: string; judge: string } {
  const d = DEFAULT_MODELS[provider];
  return { lawyer: envStr("COURT_LAWYER_MODEL") ?? d.lawyer, judge: envStr("COURT_JUDGE_MODEL") ?? d.judge };
}

export const LAWYER_MODEL = modelsFor("anthropic").lawyer;
export const JUDGE_MODEL = modelsFor("anthropic").judge;

type PriceList = { verifiedAt: string; models: Record<string, number[]>; haikuLongContextThreshold: number; haikuLongContextRates: number[] };

// shared/model-prices.json next to court/ by default; COURT_PRICES_PATH for a court deployed on its own.
// Without a price list the court still runs, and every trial's cost is marked incomplete.
function loadPrices(): PriceList {
  const path = envStr("COURT_PRICES_PATH") ?? new URL("../../shared/model-prices.json", import.meta.url);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PriceList;
  } catch (err) {
    console.warn(`court: no price list at ${String(path)} (${(err as Error).message}); trial costs will be marked incomplete`);
    return { verifiedAt: "unknown", models: {}, haikuLongContextThreshold: Infinity, haikuLongContextRates: [] };
  }
}

const PRICES = loadPrices();

type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation?: { ephemeral_1h_input_tokens?: number } | null };

// null when the model has no price in shared/model-prices.json: the trial's cost is then incomplete.
export function costOf(model: string, usage: Usage): number | null {
  const key = PRICES.models[model] ? model : model.replace(/-\d{8}$/, "");
  const writes = usage.cache_creation_input_tokens ?? 0;
  const reads = usage.cache_read_input_tokens ?? 0;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const long = key === "claude-haiku-5-5" && usage.input_tokens + writes + reads > PRICES.haikuLongContextThreshold;
  const rates = long ? PRICES.haikuLongContextRates : PRICES.models[key];
  if (!rates?.length) return null;
  return (usage.input_tokens * rates[0] + usage.output_tokens * rates[1] + (writes - hour) * rates[2] + hour * rates[3] + reads * rates[4]) / 1_000_000;
}

function accounting(model: string, usage: Usage) {
  const cost = costOf(model, usage);
  return { costUsd: cost ?? 0, costComplete: cost !== null };
}

// The engine gives up on the court after 60s, so a whole trial must finish well inside that.
const DEADLINE_MS = envNum("COURT_DEADLINE_MS", 50_000, 1);

const ArgumentSchema = z.object({
  argument: z.string(),
  cited_events: z.array(z.number().int()),
  recommended_ruling: z.enum(["continue", "change_strategy", "escalate", "halt"]),
});

const VerdictSchema = z.object({
  ruling: z.enum(["continue", "change_strategy", "escalate", "halt"]),
  instruction: z.string().describe('Required for change_strategy; empty string "" otherwise.'),
  reasoning: z.string(),
  cited_events: z.array(z.number().int()),
});

export type CourtOptions = {
  mock?: boolean; // force mock mode; defaults to true when no API credentials are set
  provider?: Provider;
  client?: Anthropic;
  groq?: Groq;
  onTrial?: (trial: Trial) => void | Promise<void>;
  past?: Trial[]; // earlier trials: precedent for the Judge, and history for the summary-judgment rules
  rules?: RulesConfig; // defaults to rulesConfig() from env
  now?: number; // for tests
};

function useMock(opts: CourtOptions): boolean {
  if (opts.mock !== undefined) return opts.mock;
  if (envStr("COURT_MOCK") === "1") return true;
  return !opts.client && !opts.groq && !opts.provider && resolveProvider() === null;
}

// One structured call to a model: system + user prompt in, schema-checked object out.
// A reply that arrives but can't be used still reports what it cost; transport errors throw.
type Reply<T> = { out: T | null; model: string; costUsd: number; costComplete: boolean; usage?: Record<string, unknown>; problem?: string };
type Ask = <T>(role: "lawyer" | "judge", system: string, user: string, schema: z.ZodType<T>, name: string, signal: AbortSignal) => Promise<Reply<T>>;

function backend(opts: CourtOptions): { ask: Ask; models: { lawyer: string; judge: string } } {
  const provider = opts.provider ?? (opts.groq ? "groq" : opts.client ? "anthropic" : (resolveProvider() ?? "anthropic"));
  const models = modelsFor(provider);
  return {
    models,
    ask:
      provider === "groq"
        ? // The free tier rate-limits; the SDK backs off and retries inside the trial deadline.
          groqAsk(opts.groq ?? new Groq({ maxRetries: 3, timeout: 25_000 }), models)
        : anthropicAsk(opts.client ?? new Anthropic({ maxRetries: 0, timeout: 60_000 }), models),
  };
}

function anthropicAsk(client: Anthropic, models: { lawyer: string; judge: string }): Ask {
  return async <T,>(role: "lawyer" | "judge", system: string, user: string, schema: z.ZodType<T>, _name: string, signal: AbortSignal) => {
    // Lawyers on the plain endpoint; the Judge gets server-side refusal fallbacks.
    const res =
      role === "lawyer"
        ? await client.messages.parse(
            {
              model: models.lawyer,
              max_tokens: 2000,
              system,
              messages: [{ role: "user", content: user }],
              output_config: { effort: "low", format: zodOutputFormat(schema) },
            },
            { signal },
          )
        : await client.beta.messages.parse(
            {
              model: models.judge,
              max_tokens: 4000,
              system,
              messages: [{ role: "user", content: user }],
              output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            },
            { signal },
          );
    const out = res.parsed_output as T | null;
    const problem = res.stop_reason === "refusal" || !out ? `no output (stop_reason: ${res.stop_reason})` : undefined;
    return { out: problem ? null : out, model: res.model, usage: { ...res.usage }, ...accounting(res.model, res.usage), problem };
  };
}

function groqAsk(client: Groq, models: { lawyer: string; judge: string }): Ask {
  return async (role, system, user, schema, name, signal) => {
    const model = role === "lawyer" ? models.lawyer : models.judge;
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const request = (format: "json_schema" | "json_object") =>
      client.chat.completions.create(
        {
          model,
          max_completion_tokens: role === "lawyer" ? 2000 : 4000,
          reasoning_effort: role === "lawyer" ? "low" : "medium",
          messages: [
            { role: "system", content: format === "json_object" ? `${system}\nReply with one JSON object matching: ${JSON.stringify(jsonSchema)}` : system },
            { role: "user", content: user },
          ],
          response_format: format === "json_schema" ? { type: "json_schema", json_schema: { name, schema: jsonSchema } } : { type: "json_object" },
        },
        { signal },
      );
    let res;
    try {
      res = await request("json_schema");
    } catch (err) {
      // Not every Groq model supports json_schema; plain JSON mode plus our own check works everywhere.
      if (!(err instanceof Groq.BadRequestError)) throw err;
      res = await request("json_object");
    }
    const served = res.model ?? model;
    const usage = { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 };
    const spend = { model: served, usage: { ...usage }, ...accounting(served, usage) };
    const text = res.choices[0]?.message?.content;
    if (!text) return { out: null, ...spend, problem: `no output (finish_reason: ${res.choices[0]?.finish_reason})` };
    try {
      return { out: schema.parse(JSON.parse(text)), ...spend };
    } catch (err) {
      return { out: null, ...spend, problem: `invalid output: ${String(err).slice(0, 300)}` };
    }
  };
}

// The contract Person A calls: charge in, verdict out.
export async function convene(packet: EvidencePacket, opts: CourtOptions = {}): Promise<Verdict> {
  return (await holdTrial(packet, opts)).verdict;
}

// Full trial record, for the case log and the courtroom scene.
export async function holdTrial(packet: EvidencePacket, opts: CourtOptions = {}): Promise<Trial> {
  const startedAt = new Date().toISOString();
  const mock = useMock(opts);

  // Repeat offenders and an over-budget court skip the trial entirely: no model calls.
  const summary = opts.past ? summaryJudgment(packet, opts.past, opts.rules ?? rulesConfig(), opts.now) : null;
  if (summary) {
    const trial: Trial = {
      id: `case-${randomUUID().slice(0, 8)}`,
      workerId: packet.workerId,
      charge: packet.charge,
      prosecution: summaryArgument("prosecution", summary.prosecution),
      defense: summaryArgument("defense", summary.defense),
      verdict: summary.verdict,
      summary: summary.kind,
      priorCaseIds: summary.priorCaseIds,
      runSince: packet.runSince,
      judgeModel: "none",
      costUsd: 0,
      costComplete: true,
      pricingDate: PRICES.verifiedAt,
      startedAt,
      finishedAt: new Date().toISOString(),
      mock,
    };
    await opts.onTrial?.(trial);
    return trial;
  }
  const court = mock ? undefined : backend(opts);
  const evidence = renderPacket(packet);
  const validIds = new Set(packet.events.map((e) => e.id));
  const signal = AbortSignal.timeout(DEADLINE_MS);

  const [prosecution, defense] = await Promise.all(
    (["prosecution", "defense"] as Side[]).map((side) =>
      court ? argue(court.ask, court.models.lawyer, side, evidence, validIds, signal) : Promise.resolve(mockArgument(side, packet)),
    ),
  );

  const precedents = opts.past?.length ? findPrecedents(packet, opts.past) : [];

  const judged = court
    ? await judge(court.ask, court.models.judge, evidence, prosecution, defense, validIds, signal, renderPrecedents(precedents))
    : { verdict: mockVerdict(packet), costUsd: 0, costComplete: true, model: "mock", usage: undefined };

  const trial: Trial = {
    id: `case-${randomUUID().slice(0, 8)}`,
    workerId: packet.workerId,
    charge: packet.charge,
    prosecution,
    defense,
    verdict: judged.verdict,
    precedents: precedents.map((t) => t.id),
    runSince: packet.runSince,
    judgeModel: judged.model,
    judgeUsage: judged.usage,
    costUsd: round(prosecution.costUsd + defense.costUsd + judged.costUsd),
    costComplete: (prosecution.costComplete ?? mock) && (defense.costComplete ?? mock) && judged.costComplete,
    pricingDate: PRICES.verifiedAt,
    startedAt,
    finishedAt: new Date().toISOString(),
    mock,
  };
  await opts.onTrial?.(trial);
  return trial;
}

async function argue(ask: Ask, model: string, side: Side, evidence: string, validIds: Set<number>, signal: AbortSignal): Promise<Argument> {
  const system = side === "prosecution" ? PROSECUTOR_SYSTEM : DEFENSE_SYSTEM;
  const rests = (why: string) => `The ${side} rests without argument (court error: ${why}).`;
  try {
    const res = await ask("lawyer", system, `EVIDENCE PACKET\n\n${evidence}\n\nMake your argument.`, ArgumentSchema, "argument", signal);
    const spend = { costUsd: res.costUsd, costComplete: res.costComplete, usage: res.usage };
    if (!res.out) return { side, model: res.model, argument: rests(res.problem ?? "no output"), cited_events: [], ...spend };
    return { side, model: res.model, argument: res.out.argument, cited_events: res.out.cited_events.filter((id) => validIds.has(id)), ...spend };
  } catch (err) {
    // Nothing came back, so nothing is known about what it cost.
    return { side, model, argument: rests(String(err)), cited_events: [], costUsd: 0, costComplete: false };
  }
}

async function judge(
  ask: Ask,
  model: string,
  evidence: string,
  prosecution: Argument,
  defense: Argument,
  validIds: Set<number>,
  signal: AbortSignal,
  precedents = "",
): Promise<{ verdict: Verdict; costUsd: number; costComplete: boolean; model: string; usage?: Record<string, unknown> }> {
  const prior = precedents ? `\n\n${precedents}\n(Earlier rulings on similar charges. Follow them only where this case's evidence is truly alike.)` : "";
  const content = `EVIDENCE PACKET\n\n${evidence}${prior}\n\nPROSECUTION ARGUES:\n${prosecution.argument}\n\nDEFENSE ARGUES:\n${defense.argument}\n\nIssue your verdict.`;
  const noVerdict = (why: string): Verdict => ({ ruling: "escalate", reasoning: `The court could not reach a verdict (${why}), so the case goes to a human.`, cited_events: [] });
  try {
    const res = await ask("judge", JUDGE_SYSTEM, content, VerdictSchema, "verdict", signal);
    const spend = { costUsd: res.costUsd, costComplete: res.costComplete, model: res.model, usage: res.usage };
    return { verdict: res.out ? normalizeVerdict(res.out, validIds) : noVerdict(res.problem ?? "no output"), ...spend };
  } catch (err) {
    return { verdict: noVerdict(String(err)), costUsd: 0, costComplete: false, model };
  }
}

export function normalizeVerdict(raw: z.infer<typeof VerdictSchema>, validIds: Set<number>): Verdict {
  const cited = raw.cited_events.filter((id) => validIds.has(id));
  const instruction = raw.instruction.trim();
  if (raw.ruling === "change_strategy" && !instruction) {
    // A strategy change the worker can't act on is no ruling at all.
    return { ruling: "escalate", reasoning: `${raw.reasoning} (No instruction was given for the strategy change, so the case goes to a human.)`, cited_events: cited };
  }
  return raw.ruling === "change_strategy"
    ? { ruling: raw.ruling, instruction, reasoning: raw.reasoning, cited_events: cited }
    : { ruling: raw.ruling, reasoning: raw.reasoning, cited_events: cited };
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
