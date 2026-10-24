import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Groq from "groq-sdk";
import { holdTrial, modelsFor, resolveProvider } from "../src/court.ts";
import { envNum, envStr } from "../src/env.ts";
import { buildPacket } from "../src/packet.ts";
import { loadFixture } from "./helpers.ts";

const BLANKS = ["", "   ", "\t"];
const run = loadFixture();
const packet = buildPacket(run.charge, run.events, { budgetUsd: run.budgetUsd });

// Sets env vars for one test body, then restores them.
async function withEnv(vars: Record<string, string | undefined>, body: () => unknown) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  apply(vars);
  try {
    await body();
  } finally {
    apply(saved);
  }
}

// A fresh process with only the given COURT_* / key vars set, for values read when a module loads.
function childEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(COURT_|ANTHROPIC_|GROQ_)/.test(k)) delete env[k];
  return { ...env, ...vars };
}

// ---- envStr / envNum ----

test("envStr: blank or whitespace means unset; other values are trimmed", async () => {
  for (const blank of BLANKS) await withEnv({ X_TEST: blank }, () => assert.equal(envStr("X_TEST"), undefined));
  await withEnv({ X_TEST: undefined }, () => assert.equal(envStr("X_TEST"), undefined));
  await withEnv({ X_TEST: "  groq " }, () => assert.equal(envStr("X_TEST"), "groq"));
});

test("envNum: blank, non-numeric, non-finite, or below min falls back", async () => {
  for (const bad of [...BLANKS, "abc", "NaN", "Infinity", "-1"]) {
    await withEnv({ X_TEST: bad }, () => assert.equal(envNum("X_TEST", 42), 42, JSON.stringify(bad)));
  }
  await withEnv({ X_TEST: "0" }, () => {
    assert.equal(envNum("X_TEST", 42), 0, "0 is allowed when min is 0");
    assert.equal(envNum("X_TEST", 42, 1), 42, "but not when min is 1 (DEADLINE, PORT)");
  });
  await withEnv({ X_TEST: " 5123 " }, () => assert.equal(envNum("X_TEST", 42, 1), 5123));
});

// ---- model and provider choice (read at call time) ----

test("blank COURT_LAWYER_MODEL / COURT_JUDGE_MODEL use the provider defaults", async () => {
  for (const blank of BLANKS) {
    await withEnv({ COURT_LAWYER_MODEL: blank, COURT_JUDGE_MODEL: blank }, () => {
      assert.deepEqual(modelsFor("anthropic"), { lawyer: "claude-haiku-5-5", judge: "claude-opus-5-5" });
      assert.deepEqual(modelsFor("groq"), { lawyer: "openai/gpt-oss-20b", judge: "openai/gpt-oss-120b" });
    });
  }
  await withEnv({ COURT_LAWYER_MODEL: " claude-sonnet-5-5 " }, () => assert.equal(modelsFor("anthropic").lawyer, "claude-sonnet-5-5"));
});

test("a blank COURT_LAWYER_MODEL sends the real request to the default lawyer model", async () => {
  const models: string[] = [];
  const groq = {
    chat: {
      completions: {
        create: async (req: { model: string }) => {
          models.push(req.model);
          const out = req.model.endsWith("20b")
            ? { argument: "a", cited_events: [], recommended_ruling: "continue" }
            : { ruling: "continue", instruction: "", reasoning: "r", cited_events: [] };
          return { model: req.model, choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
  } as unknown as Groq;
  await withEnv({ COURT_LAWYER_MODEL: "", COURT_JUDGE_MODEL: " " }, async () => {
    await holdTrial(packet, { mock: false, groq });
  });
  assert.deepEqual(models.sort(), ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "openai/gpt-oss-20b"]);
});

test("blank provider settings are ignored when choosing a provider", async () => {
  await withEnv({ COURT_PROVIDER: " ", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "  ", GROQ_API_KEY: "gsk_test" }, () => assert.equal(resolveProvider(), "groq"));
  await withEnv({ COURT_PROVIDER: "", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: undefined, GROQ_API_KEY: "\t" }, () => assert.equal(resolveProvider(), null));
});

// ---- COURT_DEADLINE_MS (read when court.ts loads, so in a child process) ----

// Every model call answers after 150ms, unless the court's deadline has aborted it by then.
const DEADLINE_CHILD = `
const { holdTrial } = await import(process.env.COURT_MODULE);
const { readFileSync } = await import("node:fs");
const packet = JSON.parse(readFileSync(0, "utf8"));
const slow = (out) => async (_body, opts) => {
  await new Promise((r) => setTimeout(r, 150));
  if (opts.signal.aborted) throw opts.signal.reason;
  return { model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: out };
};
const client = {
  messages: { parse: slow({ argument: "It loops.", cited_events: [], recommended_ruling: "change_strategy" }) },
  beta: { messages: { parse: slow({ ruling: "change_strategy", instruction: "Mock the API.", reasoning: "Stuck.", cited_events: [] }) } },
};
const t = await holdTrial(packet, { mock: false, client });
console.log(JSON.stringify({ prosecution: t.prosecution.argument, ruling: t.verdict.ruling }));
`;

function trialWithDeadline(value: string) {
  const env = childEnv({ COURT_DEADLINE_MS: value, COURT_MODULE: new URL("../src/court.ts", import.meta.url).href });
  const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", DEADLINE_CHILD], { env, input: JSON.stringify(packet), encoding: "utf8", timeout: 20_000 });
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim().split("\n").at(-1)!) as { prosecution: string; ruling: string };
}

test("blank, zero, or junk COURT_DEADLINE_MS falls back to the 50s default instead of aborting at once", () => {
  for (const value of ["", "   ", "0", "abc"]) {
    const t = trialWithDeadline(value);
    assert.equal(t.prosecution, "It loops.", `COURT_DEADLINE_MS=${JSON.stringify(value)} cut the trial short`);
    assert.equal(t.ruling, "change_strategy");
  }
});

test("control: COURT_DEADLINE_MS=50 does cut the same slow trial short", () => {
  const t = trialWithDeadline("50");
  assert.match(t.prosecution, /rests without argument/);
  assert.equal(t.ruling, "escalate");
});

// ---- COURT_PORT (read when server.ts loads) ----

// Starts the server and returns the port it reports: from its "listening" line, or from
// EADDRINUSE if something already holds that port. Either way the server is stopped.
function serverPort(value: string): Promise<number> {
  const cases = mkdtempSync(join(tmpdir(), "court-cases-"));
  const env = childEnv({ COURT_PORT: value, COURT_HOST: "127.0.0.1", COURT_CASES_DIR: cases, COURT_MOCK: "1" });
  const child = spawn(process.execPath, ["--import", "tsx", new URL("../src/server.ts", import.meta.url).pathname], { env });
  let out = "";
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no port reported; output: ${out}`)), 15_000);
    const check = (chunk: Buffer) => {
      out += chunk.toString();
      const m = out.match(/listening on http:\/\/localhost:(\d+)/) ?? out.match(/EADDRINUSE[^\n]*:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.on("exit", () => setTimeout(() => reject(new Error(`server exited without a port; output: ${out}`)), 100));
  }).finally(() => {
    child.kill();
    rmSync(cases, { recursive: true, force: true });
  });
}

test("blank or invalid COURT_PORT falls back to 4100 instead of a random port", async () => {
  for (const value of ["", "  ", "0", "abc"]) assert.equal(await serverPort(value), 4100, `COURT_PORT=${JSON.stringify(value)}`);
});
