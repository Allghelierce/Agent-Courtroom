import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { buildPacket } from "../src/packet.ts";
import { holdTrial, LAWYER_MODEL, JUDGE_MODEL } from "../src/court.ts";
import { loadFixture } from "./helpers.ts";

const { events, charge, budgetUsd } = loadFixture();
const packet = buildPacket(charge, events, { budgetUsd });
const [c1, c2] = charge.eventIds;
const cLast = charge.eventIds.at(-1)!;

const usage = { input_tokens: 1000, output_tokens: 200 };

function lawyerReply() {
  return {
    model: LAWYER_MODEL,
    stop_reason: "end_turn",
    usage,
    parsed_output: { argument: "The worker is looping.", cited_events: [c1, c2, 999], recommended_ruling: "change_strategy" },
  };
}

function fakeClient(judge: () => Promise<unknown>, lawyer: () => Promise<unknown> = async () => lawyerReply()) {
  const calls = { lawyer: 0, judge: 0 };
  const client = {
    messages: { parse: async () => (calls.lawyer++, lawyer()) },
    beta: { messages: { parse: async () => (calls.judge++, judge()) } },
  } as unknown as Anthropic;
  return { client, calls };
}

test("real-model path returns the judge's normalized verdict", async () => {
  const { client, calls } = fakeClient(async () => ({
    model: JUDGE_MODEL,
    stop_reason: "end_turn",
    usage,
    parsed_output: { ruling: "change_strategy", instruction: "Mock the rates API.", reasoning: "Looping.", cited_events: [c1, cLast, 404] },
  }));
  const trial = await holdTrial(packet, { mock: false, client });
  assert.equal(trial.mock, false);
  assert.equal(trial.judgeModel, JUDGE_MODEL);
  assert.deepEqual(calls, { lawyer: 2, judge: 1 });
  assert.equal(trial.verdict.ruling, "change_strategy");
  assert.equal(trial.verdict.instruction, "Mock the rates API.");
  assert.deepEqual(trial.verdict.cited_events, [c1, cLast]);
  assert.deepEqual(trial.prosecution.cited_events, [c1, c2]);
  assert.deepEqual(trial.defense.cited_events, [c1, c2]);
  assert.ok(trial.costUsd > 0);
});

test("a throwing judge gives escalate", async () => {
  const { client } = fakeClient(async () => {
    throw new Error("overloaded");
  });
  const trial = await holdTrial(packet, { mock: false, client });
  assert.equal(trial.verdict.ruling, "escalate");
  assert.match(trial.verdict.reasoning, /overloaded/);
  assert.deepEqual(trial.verdict.cited_events, []);
});

test("a judge refusal gives escalate", async () => {
  const { client } = fakeClient(async () => ({ model: JUDGE_MODEL, stop_reason: "refusal", usage, parsed_output: null }));
  const trial = await holdTrial(packet, { mock: false, client });
  assert.equal(trial.verdict.ruling, "escalate");
  assert.match(trial.verdict.reasoning, /refusal/);
});

test("a throwing lawyer rests without argument and the trial still finishes", async () => {
  const { client } = fakeClient(
    async () => ({ model: JUDGE_MODEL, stop_reason: "end_turn", usage, parsed_output: { ruling: "halt", instruction: "", reasoning: "r", cited_events: [] } }),
    async () => {
      throw new Error("lawyer down");
    },
  );
  const trial = await holdTrial(packet, { mock: false, client });
  assert.match(trial.prosecution.argument, /rests without argument/);
  assert.deepEqual(trial.prosecution.cited_events, []);
  assert.equal(trial.verdict.ruling, "halt");
});
