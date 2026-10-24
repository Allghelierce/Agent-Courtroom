import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { mockArgument, mockVerdict } from "./mock.ts";
import { findPrecedents, renderPrecedents } from "./precedent.ts";
import { DEFENSE_SYSTEM, JUDGE_SYSTEM, PROSECUTOR_SYSTEM, renderPacket } from "./prompts.ts";
import type { Argument, EvidencePacket, Side, Trial, Verdict } from "./types.ts";

export const LAWYER_MODEL = process.env.COURT_LAWYER_MODEL ?? "claude-haiku-5-5";
export const JUDGE_MODEL = process.env.COURT_JUDGE_MODEL ?? "claude-opus-5-5";

const PRICES = JSON.parse(readFileSync(new URL("../../shared/model-prices.json", import.meta.url), "utf8")) as {
  verifiedAt: string; models: Record<string, number[]>; haikuLongContextThreshold: number; haikuLongContextRates: number[];
};

type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation?: { ephemeral_1h_input_tokens?: number } | null };

export function costOf(model: string, usage: Usage): number | null {
  const key = PRICES.models[model] ? model : model.replace(/-\d{8}$/, "");
  const writes = usage.cache_creation_input_tokens ?? 0;
  const reads = usage.cache_read_input_tokens ?? 0;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const long = key === "claude-haiku-5-5" && usage.input_tokens + writes + reads > PRICES.haikuLongContextThreshold;
  const rates = long ? PRICES.haikuLongContextRates : PRICES.models[key];
  if (!rates) return null;
  return (usage.input_tokens * rates[0] + usage.output_tokens * rates[1] + (writes - hour) * rates[2] + hour * rates[3] + reads * rates[4]) / 1_000_000;
}

function accounting(model: string, usage: Usage) {
  const cost = costOf(model, usage);
  return { costUsd: cost ?? 0, costComplete: cost !== null };
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
  client?: Anthropic;
  onTrial?: (trial: Trial) => void | Promise<void>;
  past?: Trial[]; // earlier trials; the most similar few are shown to the Judge as precedent
};

function useMock(opts: CourtOptions): boolean {
  if (opts.mock !== undefined) return opts.mock;
  if (process.env.COURT_MOCK === "1") return true;
  return !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
}

// The contract Person A calls: charge in, verdict out.
export async function convene(packet: EvidencePacket, opts: CourtOptions = {}): Promise<Verdict> {
  return (await holdTrial(packet, opts)).verdict;
}

// Full trial record, for the case log and the courtroom scene.
export async function holdTrial(packet: EvidencePacket, opts: CourtOptions = {}): Promise<Trial> {
  const startedAt = new Date().toISOString();
  const mock = useMock(opts);
  const client = mock ? undefined : (opts.client ?? new Anthropic({ maxRetries: 0, timeout: 60_000 }));
  const evidence = renderPacket(packet);
  const validIds = new Set(packet.events.map((e) => e.id));

  const [prosecution, defense] = await Promise.all(
    (["prosecution", "defense"] as Side[]).map((side) =>
      client ? argue(client, side, evidence, validIds) : Promise.resolve(mockArgument(side, packet)),
    ),
  );

  const precedents = opts.past?.length ? findPrecedents(packet, opts.past) : [];

  const judged = client
    ? await judge(client, evidence, prosecution, defense, validIds, renderPrecedents(precedents))
    : { verdict: mockVerdict(packet), costUsd: 0, costComplete: true, model: "mock", usage: undefined };

  const trial: Trial = {
    id: `case-${randomUUID().slice(0, 8)}`,
    workerId: packet.workerId,
    charge: packet.charge,
    prosecution,
    defense,
    verdict: judged.verdict,
    precedents: precedents.map((t) => t.id),
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

async function argue(client: Anthropic, side: Side, evidence: string, validIds: Set<number>): Promise<Argument> {
  let spend = { costUsd: 0, costComplete: false };
  let usage: Record<string, unknown> | undefined;
  try {
    const res = await client.messages.parse({
      model: LAWYER_MODEL,
      max_tokens: 2000,
      system: side === "prosecution" ? PROSECUTOR_SYSTEM : DEFENSE_SYSTEM,
      messages: [{ role: "user", content: `EVIDENCE PACKET\n\n${evidence}\n\nMake your argument.` }],
      output_config: { effort: "low", format: zodOutputFormat(ArgumentSchema) },
    });
    spend = accounting(res.model, res.usage);
    usage = { ...res.usage };
    const out = res.parsed_output;
    if (res.stop_reason === "refusal" || !out) throw new Error(`no argument (stop_reason: ${res.stop_reason})`);
    return {
      side,
      model: res.model,
      argument: out.argument,
      cited_events: out.cited_events.filter((id) => validIds.has(id)),
      ...spend,
      usage,
    };
  } catch (err) {
    return { side, model: LAWYER_MODEL, argument: `The ${side} rests without argument (court error: ${String(err)}).`, cited_events: [], ...spend, usage };
  }
}

async function judge(
  client: Anthropic,
  evidence: string,
  prosecution: Argument,
  defense: Argument,
  validIds: Set<number>,
  precedents = "",
): Promise<{ verdict: Verdict; costUsd: number; costComplete: boolean; model: string; usage?: Record<string, unknown> }> {
  const prior = precedents ? `\n\n${precedents}\n(Earlier rulings on similar charges. Follow them only where this case's evidence is truly alike.)` : "";
  const content = `EVIDENCE PACKET\n\n${evidence}${prior}\n\nPROSECUTION ARGUES:\n${prosecution.argument}\n\nDEFENSE ARGUES:\n${defense.argument}\n\nIssue your verdict.`;
  let spend = { costUsd: 0, costComplete: false };
  let usage: Record<string, unknown> | undefined;
  let model = JUDGE_MODEL;
  try {
    const res = await client.beta.messages.parse({
      model: JUDGE_MODEL,
      max_tokens: 4000,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: betaZodOutputFormat(VerdictSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    spend = accounting(res.model, res.usage);
    usage = { ...res.usage };
    model = res.model;
    const out = res.parsed_output;
    if (res.stop_reason === "refusal" || !out) throw new Error(`no verdict (stop_reason: ${res.stop_reason})`);
    return { verdict: normalizeVerdict(out, validIds), ...spend, model, usage };
  } catch (err) {
    return {
      verdict: { ruling: "escalate", reasoning: `The court could not reach a verdict (${String(err)}), so the case goes to a human.`, cited_events: [] },
      ...spend,
      model,
      usage,
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
