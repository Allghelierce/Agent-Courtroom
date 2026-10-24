import assert from "node:assert/strict";
import { test } from "node:test";
import type Groq from "groq-sdk";
import { holdTrial } from "../src/court.ts";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

type Req = { model: string; response_format: { type: string }; reasoning_effort: string };

function fakeGroq(reply: (req: Req) => string): { client: Groq; calls: Req[] } {
  const calls: Req[] = [];
  const client = {
    chat: {
      completions: {
        create: async (req: Req) => {
          calls.push(req);
          return { model: req.model, choices: [{ message: { content: reply(req) }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 300 } };
        },
      },
    },
  } as unknown as Groq;
  return { client, calls };
}

const run = loadFixture();
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });
const ids = run.charge.eventIds;

test("groq court: lawyers on gpt-oss-20b, judge on gpt-oss-120b, schema-checked JSON", async () => {
  const { client, calls } = fakeGroq((req) =>
    req.model === "openai/gpt-oss-20b"
      ? JSON.stringify({ argument: "It loops.", cited_events: [ids[0], 9999], recommended_ruling: "change_strategy" })
      : JSON.stringify({ ruling: "change_strategy", instruction: "Mock the API.", reasoning: "Stuck.", cited_events: [...ids, 9999] }),
  );
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.mock, false);
  assert.equal(trial.judgeModel, "openai/gpt-oss-120b");
  assert.equal(trial.prosecution.model, "openai/gpt-oss-20b");
  assert.deepEqual(trial.prosecution.cited_events, [ids[0]]);
  assert.equal(trial.verdict.ruling, "change_strategy");
  assert.deepEqual(trial.verdict.cited_events, ids);
  assert.ok(trial.costUsd > 0);
  assert.ok(calls.every((c) => c.response_format.type === "json_schema"));
  assert.deepEqual(calls.map((c) => c.reasoning_effort).sort(), ["low", "low", "medium"]);
});

test("groq court: judge output that fails the schema escalates", async () => {
  const { client } = fakeGroq((req) =>
    req.model === "openai/gpt-oss-20b" ? JSON.stringify({ argument: "a", cited_events: [], recommended_ruling: "halt" }) : JSON.stringify({ ruling: "maybe" }),
  );
  const trial = await holdTrial(packet, { mock: false, groq: client });
  assert.equal(trial.verdict.ruling, "escalate");
});
