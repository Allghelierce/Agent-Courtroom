import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import { costOf, holdTrial, JUDGE_MODEL, LAWYER_MODEL } from "../src/court.ts";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

// Expected costs come straight from the shared price table, not from costOf.
const PRICES = JSON.parse(readFileSync(new URL("../../shared/model-prices.json", import.meta.url), "utf8")) as {
  verifiedAt: string;
  fields: string[];
  models: Record<string, number[]>;
};
const rate = (model: string, field: string) => PRICES.models[model][PRICES.fields.indexOf(field)];
const usd = (model: string, input: number, output: number) => (input * rate(model, "input") + output * rate(model, "output")) / 1_000_000;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `cost ${actual}, expected ${expected}`);

const LAWYER = "openai/gpt-oss-20b";
const JUDGE = "openai/gpt-oss-120b";
const UNPRICED = "claude-unpriced-9";

const run = loadFixture();
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });
const ids = run.charge.eventIds;
const ARGUMENT = { argument: "It loops.", cited_events: [ids[0]], recommended_ruling: "change_strategy" };
const VERDICT = { ruling: "change_strategy", instruction: "Mock the API.", reasoning: "Stuck.", cited_events: ids };

// ---- fakes ----

type Reply = () => Promise<unknown>;
function anthropic(lawyer: Reply, judge: Reply): Anthropic {
  return { messages: { parse: lawyer }, beta: { messages: { parse: judge } } } as unknown as Anthropic;
}
const parsed = (model: string, out: unknown, stop_reason = "end_turn"): Reply => async () => ({ model, stop_reason, usage: { input_tokens: 1000, output_tokens: 200 }, parsed_output: out });

type GroqReq = { model: string; response_format: { type: string } };
function groq(reply: (req: GroqReq) => unknown): { client: Groq; calls: GroqReq[] } {
  const calls: GroqReq[] = [];
  const client = { chat: { completions: { create: async (req: GroqReq) => (calls.push(req), reply(req)) } } } as unknown as Groq;
  return { client, calls };
}
const completion = (model: string, content: string | null) => ({
  model,
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 2000, completion_tokens: 400 },
});
// Lawyers and Judge answer normally unless `judge` / `lawyer` override them.
const groqCourt = (o: { lawyer?: (req: GroqReq) => unknown; judge?: (req: GroqReq) => unknown } = {}) =>
  groq((req) =>
    req.model === LAWYER
      ? (o.lawyer ?? (() => completion(LAWYER, JSON.stringify(ARGUMENT))))(req)
      : (o.judge ?? (() => completion(JUDGE, JSON.stringify(VERDICT))))(req),
  );
const groqTotal = 2 * usd(LAWYER, 2000, 400) + usd(JUDGE, 2000, 400);

// ---- costOf ----

test("costOf is null for a model with no price", () => {
  assert.equal(costOf(UNPRICED, { input_tokens: 1000, output_tokens: 100 }), null);
});

test("costOf prices a dated model id like its alias", () => {
  const u = { input_tokens: 1000, output_tokens: 100 };
  const alias = costOf(JUDGE_MODEL, u);
  assert.ok(alias !== null && alias > 0);
  assert.equal(costOf(`${JUDGE_MODEL}-20261001`, u), alias);
});

test("costOf prices cache reads and 5m/1h cache writes at their own rates", () => {
  const m = JUDGE_MODEL;
  const cost = costOf(m, { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 300, cache_read_input_tokens: 700, cache_creation: { ephemeral_1h_input_tokens: 120 } });
  const expected = (100 * rate(m, "input") + 50 * rate(m, "output") + 180 * rate(m, "cacheWrite5m") + 120 * rate(m, "cacheWrite1h") + 700 * rate(m, "cacheRead")) / 1_000_000;
  close(cost!, expected);
});

// ---- (a) unpriced model ----

test("an unpriced lawyer model: its arguments cost 0 and the trial's cost is incomplete", async () => {
  const client = anthropic(parsed(UNPRICED, ARGUMENT), parsed(JUDGE_MODEL, VERDICT));
  const trial = await holdTrial(packet, { mock: false, client });
  for (const a of [trial.prosecution, trial.defense]) {
    assert.equal(a.model, UNPRICED);
    assert.equal(a.costUsd, 0);
    assert.equal(a.costComplete, false);
  }
  assert.equal(trial.costComplete, false);
  close(trial.costUsd, usd(JUDGE_MODEL, 1000, 200)); // the priced Judge still counts
  assert.equal(trial.verdict.ruling, "change_strategy"); // pricing never changes the ruling
});

test("an unpriced judge model: the trial's cost is incomplete, priced lawyers still count", async () => {
  const { client } = groqCourt({ judge: () => completion("openai/gpt-oss-999b", JSON.stringify(VERDICT)) });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.judgeModel, "openai/gpt-oss-999b"); // priced by the model that served it
  assert.equal(trial.costComplete, false);
  close(trial.costUsd, 2 * usd(LAWYER, 2000, 400));
});

// ---- (b) Groq-priced ----

test("groq-priced trial: costComplete true, cost from the price table, usage recorded", async () => {
  const { client } = groqCourt();
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.costComplete, true);
  assert.equal(trial.prosecution.costComplete, true);
  assert.equal(trial.defense.costComplete, true);
  close(trial.prosecution.costUsd, usd(LAWYER, 2000, 400));
  close(trial.costUsd, groqTotal);
  assert.deepEqual(trial.prosecution.usage, { input_tokens: 2000, output_tokens: 400 });
  assert.deepEqual(trial.judgeUsage, { input_tokens: 2000, output_tokens: 400 });
  assert.equal(trial.pricingDate, PRICES.verifiedAt);
});

test("groq json_schema 400 falls back to json_object, and the reply is still priced", async () => {
  const { client, calls } = groq((req) => {
    if (req.response_format.type === "json_schema") throw new Groq.BadRequestError(400, {}, "json_schema not supported", new Headers());
    return req.model === LAWYER ? completion(LAWYER, JSON.stringify(ARGUMENT)) : completion(JUDGE, JSON.stringify(VERDICT));
  });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.deepEqual(calls.map((c) => c.response_format.type).sort(), ["json_object", "json_object", "json_object", "json_schema", "json_schema", "json_schema"]);
  assert.equal(trial.verdict.ruling, "change_strategy");
  assert.equal(trial.costComplete, true);
  close(trial.costUsd, groqTotal);
});

// ---- (c) a reply arrives but can't be used: its cost is still recorded ----

for (const [label, content] of [
  ["text that isn't JSON", "Sure! The worker is clearly looping."],
  ["JSON that fails the schema", JSON.stringify({ ruling: "maybe" })],
] as const) {
  test(`groq judge returns ${label}: escalate, with its cost recorded`, async () => {
    const { client } = groqCourt({ judge: () => completion(JUDGE, content) });
    const trial = await holdTrial(packet, { mock: false, groq: client });
    assert.equal(trial.verdict.ruling, "escalate");
    assert.match(trial.verdict.reasoning, /invalid output/);
    assert.equal(trial.costComplete, true);
    close(trial.costUsd, groqTotal);
    assert.ok(trial.costUsd - trial.prosecution.costUsd - trial.defense.costUsd > 0, "judge cost is counted");
  });
}

test("groq lawyer reply that fails the schema rests, but its cost counts", async () => {
  const { client } = groqCourt({ lawyer: () => completion(LAWYER, "{}") });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.match(trial.prosecution.argument, /rests without argument.*invalid output/);
  assert.equal(trial.prosecution.costComplete, true);
  close(trial.prosecution.costUsd, usd(LAWYER, 2000, 400));
  close(trial.costUsd, groqTotal);
});

test("groq reply with no content still records its cost", async () => {
  const { client } = groqCourt({ judge: () => completion(JUDGE, null) });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.verdict.ruling, "escalate");
  assert.match(trial.verdict.reasoning, /no output/);
  assert.equal(trial.costComplete, true);
  close(trial.costUsd, groqTotal);
});

test("anthropic judge refusal escalates and still records its cost", async () => {
  const client = anthropic(parsed(LAWYER_MODEL, ARGUMENT), parsed(JUDGE_MODEL, null, "refusal"));
  const trial = await holdTrial(packet, { mock: false, client });
  assert.equal(trial.verdict.ruling, "escalate");
  assert.equal(trial.costComplete, true);
  close(trial.costUsd, 2 * usd(LAWYER_MODEL, 1000, 200) + usd(JUDGE_MODEL, 1000, 200));
});

// ---- (d) transport errors: nothing came back, so the cost is unknown ----

test("groq transport error on a lawyer: it rests with cost 0 and costComplete false", async () => {
  const { client } = groqCourt({
    lawyer: () => {
      throw new Groq.APIConnectionError({ message: "socket hang up" });
    },
  });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  for (const a of [trial.prosecution, trial.defense]) {
    assert.match(a.argument, /rests without argument.*socket hang up/);
    assert.equal(a.costUsd, 0);
    assert.equal(a.costComplete, false);
  }
  assert.equal(trial.costComplete, false);
  close(trial.costUsd, usd(JUDGE, 2000, 400));
  assert.equal(trial.verdict.ruling, "change_strategy"); // the Judge still rules
});

test("groq transport error on the judge: escalate, costComplete false, lawyer costs kept", async () => {
  const { client } = groqCourt({
    judge: () => {
      throw new Groq.APIConnectionTimeoutError({ message: "Request timed out." });
    },
  });
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.verdict.ruling, "escalate");
  assert.match(trial.verdict.reasoning, /timed out/);
  assert.equal(trial.costComplete, false);
  close(trial.costUsd, 2 * usd(LAWYER, 2000, 400));
});

test("anthropic transport error: costComplete false", async () => {
  const client = anthropic(async () => {
    throw new Error("ECONNRESET");
  }, parsed(JUDGE_MODEL, VERDICT));
  const trial = await holdTrial(packet, { mock: false, client });
  assert.equal(trial.prosecution.costComplete, false);
  assert.equal(trial.costComplete, false);
  close(trial.costUsd, usd(JUDGE_MODEL, 1000, 200));
});

// ---- missing price list (COURT_PRICES_PATH) ----

// PRICES loads when court.ts is imported, so each case runs court.ts in a fresh child process.
// The child holds one real-path trial on a fake Anthropic client and prints what it saw.
const CHILD = `
const { costOf, holdTrial } = await import(process.env.COURT_MODULE);
const { readFileSync } = await import("node:fs");
const packet = JSON.parse(readFileSync(0, "utf8"));
const reply = (model, out) => async () => ({ model, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 }, parsed_output: out });
const client = {
  messages: { parse: reply("claude-haiku-5-5", { argument: "It loops.", cited_events: [], recommended_ruling: "change_strategy" }) },
  beta: { messages: { parse: reply("claude-opus-5-5", { ruling: "change_strategy", instruction: "Mock the API.", reasoning: "Stuck.", cited_events: [] }) } },
};
const trial = await holdTrial(packet, { mock: false, client });
console.log(JSON.stringify({ cost: costOf("claude-opus-5-5", { input_tokens: 1000, output_tokens: 200 }), trial }));
`;

function courtWithPrices(pricesPath: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env, COURT_MODULE: new URL("../src/court.ts", import.meta.url).href };
  delete env.COURT_PRICES_PATH;
  if (pricesPath !== undefined) env.COURT_PRICES_PATH = pricesPath;
  const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", CHILD], { env, input: JSON.stringify(packet), encoding: "utf8" });
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  return { ...(JSON.parse(res.stdout.trim().split("\n").at(-1)!) as { cost: number | null; trial: { costUsd: number; costComplete: boolean; pricingDate: string; verdict: { ruling: string } } }), stderr: res.stderr };
}

test("missing price list: court.ts still loads, costOf is null, a real-path trial is costComplete false", () => {
  const { cost, trial, stderr } = courtWithPrices("/nonexistent/model-prices.json");
  assert.equal(cost, null);
  assert.equal(trial.costComplete, false);
  assert.equal(trial.costUsd, 0);
  assert.equal(trial.pricingDate, "unknown");
  assert.equal(trial.verdict.ruling, "change_strategy", "the trial itself still runs");
  assert.match(stderr, /no price list at \/nonexistent\/model-prices\.json/);
});

test("COURT_PRICES_PATH unset, blank, or pointing at a real price list prices the trial (control for the test above)", () => {
  const shared = new URL("../../shared/model-prices.json", import.meta.url).pathname;
  // Blank means unset (6db4c5e), so it falls back to the shared list instead of reading the path "".
  for (const path of [undefined, shared, "", "   "]) {
    const { cost, trial, stderr } = courtWithPrices(path);
    close(cost!, usd("claude-opus-5-5", 1000, 200));
    assert.equal(trial.costComplete, true);
    assert.equal(trial.pricingDate, PRICES.verifiedAt);
    assert.doesNotMatch(stderr, /no price list/);
  }
});
