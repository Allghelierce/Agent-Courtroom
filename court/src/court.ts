import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import Groq from "groq-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mockArgument, mockVerdict } from "./mock.ts";
import { findPrecedents, renderPrecedents } from "./precedent.ts";
import { DEFENSE_SYSTEM, JUDGE_SYSTEM, PROSECUTOR_SYSTEM, renderPacket } from "./prompts.ts";
import type { Argument, EvidencePacket, Side, Trial, Verdict } from "./types.ts";

// Which model API the court calls. Auto: Anthropic if its key is set, else Groq if
// GROQ_API_KEY is set, else the mock. COURT_PROVIDER=anthropic|groq forces one.
export type Provider = "anthropic" | "groq";

export function resolveProvider(): Provider | null {
  const forced = process.env.COURT_PROVIDER;
  if (forced === "anthropic" || forced === "groq") return forced;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

const DEFAULT_MODELS: Record<Provider, { lawyer: string; judge: string }> = {
  anthropic: { lawyer: "claude-haiku-5-5", judge: "claude-opus-5-5" },
  groq: { lawyer: "openai/gpt-oss-20b", judge: "openai/gpt-oss-120b" },
};

export function modelsFor(provider: Provider): { lawyer: string; judge: string } {
  const d = DEFAULT_MODELS[provider];
  return { lawyer: process.env.COURT_LAWYER_MODEL ?? d.lawyer, judge: process.env.COURT_JUDGE_MODEL ?? d.judge };
}

export const LAWYER_MODEL = modelsFor("anthropic").lawyer;
export const JUDGE_MODEL = modelsFor("anthropic").judge;

// USD per million tokens (input, output). Haiku 5.5 rate is for prompts under 100K tokens,
// which court prompts always are.
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-fable-5-1": [10, 50],
  // Groq's listed rates, as used by the engine's GroqBrain.
  "openai/gpt-oss-120b": [0.15, 0.6],
  "openai/gpt-oss-20b": [0.075, 0.3],
};

export function costOf(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const [i, o] = PRICES[model] ?? PRICES[JUDGE_MODEL] ?? [0, 0];
  return (usage.input_tokens * i + usage.output_tokens * o) / 1_000_000;
}

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
  past?: Trial[]; // earlier trials; the most similar few are shown to the Judge as precedent
};

function useMock(opts: CourtOptions): boolean {
  if (opts.mock !== undefined) return opts.mock;
  if (process.env.COURT_MOCK === "1") return true;
  return !opts.client && !opts.groq && !opts.provider && resolveProvider() === null;
}

// One structured call to a model: system + user prompt in, schema-checked object out.
type Ask = <T>(role: "lawyer" | "judge", system: string, user: string, schema: z.ZodType<T>, name: string) => Promise<{ out: T; model: string; costUsd: number }>;

function backend(opts: CourtOptions): { ask: Ask; models: { lawyer: string; judge: string } } {
  const provider = opts.provider ?? (opts.groq ? "groq" : opts.client ? "anthropic" : (resolveProvider() ?? "anthropic"));
  const models = modelsFor(provider);
  return { models, ask: provider === "groq" ? groqAsk(opts.groq ?? new Groq(), models) : anthropicAsk(opts.client ?? new Anthropic(), models) };
}

function anthropicAsk(client: Anthropic, models: { lawyer: string; judge: string }): Ask {
  return async <T,>(role: "lawyer" | "judge", system: string, user: string, schema: z.ZodType<T>) => {
    // Lawyers on the plain endpoint; the Judge gets server-side refusal fallbacks.
    const res =
      role === "lawyer"
        ? await client.messages.parse({
            model: models.lawyer,
            max_tokens: 2000,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { effort: "low", format: zodOutputFormat(schema) },
          })
        : await client.beta.messages.parse({
            model: models.judge,
            max_tokens: 4000,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          });
    const out = res.parsed_output as T | null;
    if (res.stop_reason === "refusal" || !out) throw new Error(`no output (stop_reason: ${res.stop_reason})`);
    return { out, model: res.model, costUsd: costOf(res.model, res.usage) };
  };
}

function groqAsk(client: Groq, models: { lawyer: string; judge: string }): Ask {
  return async (role, system, user, schema, name) => {
    const model = role === "lawyer" ? models.lawyer : models.judge;
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const request = (format: "json_schema" | "json_object") =>
      client.chat.completions.create({
        model,
        max_completion_tokens: role === "lawyer" ? 2000 : 4000,
        reasoning_effort: role === "lawyer" ? "low" : "medium",
        messages: [
          { role: "system", content: format === "json_object" ? `${system}\nReply with one JSON object matching: ${JSON.stringify(jsonSchema)}` : system },
          { role: "user", content: user },
        ],
        response_format: format === "json_schema" ? { type: "json_schema", json_schema: { name, schema: jsonSchema } } : { type: "json_object" },
      });
    let res;
    try {
      res = await request("json_schema");
    } catch (err) {
      // Not every Groq model supports json_schema; plain JSON mode plus our own check works everywhere.
      if (!(err instanceof Groq.BadRequestError)) throw err;
      res = await request("json_object");
    }
    const text = res.choices[0]?.message?.content;
    if (!text) throw new Error(`no output (finish_reason: ${res.choices[0]?.finish_reason})`);
    const out = schema.parse(JSON.parse(text));
    const usage = { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 };
    return { out, model: res.model ?? model, costUsd: costOf(res.model ?? model, usage) };
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
  const court = mock ? undefined : backend(opts);
  const evidence = renderPacket(packet);
  const validIds = new Set(packet.events.map((e) => e.id));

  const [prosecution, defense] = await Promise.all(
    (["prosecution", "defense"] as Side[]).map((side) =>
      court ? argue(court.ask, court.models.lawyer, side, evidence, validIds) : Promise.resolve(mockArgument(side, packet)),
    ),
  );

  const precedents = opts.past?.length ? findPrecedents(packet, opts.past) : [];

  const { verdict, costUsd: judgeCost } = court
    ? await judge(court.ask, evidence, prosecution, defense, validIds, renderPrecedents(precedents))
    : { verdict: mockVerdict(packet), costUsd: 0 };

  const trial: Trial = {
    id: `case-${randomUUID().slice(0, 8)}`,
    workerId: packet.workerId,
    charge: packet.charge,
    prosecution,
    defense,
    verdict,
    precedents: precedents.map((t) => t.id),
    judgeModel: court ? court.models.judge : "mock",
    costUsd: round(prosecution.costUsd + defense.costUsd + judgeCost),
    startedAt,
    finishedAt: new Date().toISOString(),
    mock,
  };
  await opts.onTrial?.(trial);
  return trial;
}

async function argue(ask: Ask, model: string, side: Side, evidence: string, validIds: Set<number>): Promise<Argument> {
  try {
    const system = side === "prosecution" ? PROSECUTOR_SYSTEM : DEFENSE_SYSTEM;
    const res = await ask("lawyer", system, `EVIDENCE PACKET\n\n${evidence}\n\nMake your argument.`, ArgumentSchema, "argument");
    return {
      side,
      model: res.model,
      argument: res.out.argument,
      cited_events: res.out.cited_events.filter((id) => validIds.has(id)),
      costUsd: res.costUsd,
    };
  } catch (err) {
    return { side, model, argument: `The ${side} rests without argument (court error: ${String(err)}).`, cited_events: [], costUsd: 0 };
  }
}

async function judge(
  ask: Ask,
  evidence: string,
  prosecution: Argument,
  defense: Argument,
  validIds: Set<number>,
  precedents = "",
): Promise<{ verdict: Verdict; costUsd: number }> {
  const prior = precedents ? `\n\n${precedents}\n(Earlier rulings on similar charges. Follow them only where this case's evidence is truly alike.)` : "";
  const content = `EVIDENCE PACKET\n\n${evidence}${prior}\n\nPROSECUTION ARGUES:\n${prosecution.argument}\n\nDEFENSE ARGUES:\n${defense.argument}\n\nIssue your verdict.`;
  try {
    const res = await ask("judge", JUDGE_SYSTEM, content, VerdictSchema, "verdict");
    return { verdict: normalizeVerdict(res.out, validIds), costUsd: res.costUsd };
  } catch (err) {
    return {
      verdict: { ruling: "escalate", reasoning: `The court could not reach a verdict (${String(err)}), so the case goes to a human.`, cited_events: [] },
      costUsd: 0,
    };
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
