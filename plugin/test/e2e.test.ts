// Drives the committed plugin the way Claude Code does: each hook is `node dist/hook.mjs <Event>`
// with JSON on stdin. The first hook starts the daemon (mock court, temp home, free port).
// It doesn't rebuild dist/: test/dist.test.ts fails if dist/ is stale.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = new URL("../", import.meta.url).pathname;
const home = mkdtempSync(join(tmpdir(), "courtroom-e2e-"));
const transcript = join(home, "transcript.jsonl");
let port = 0;
let env: NodeJS.ProcessEnv;
const base = () => `http://127.0.0.1:${port}`;

const UNITTEST_FAIL = `Ran 11 tests in 0.0{N}s

FAILED (errors=1)
ERROR: test_checkout_charges_the_gateway (test_checkout.TestCheckout)
urllib.error.URLError: <urlopen error [Errno 61] Connection refused>`;

function hook(event: string, input: Record<string, unknown>) {
  const r = spawnSync(process.execPath, [join(plugin, "dist/hook.mjs"), event], {
    input: JSON.stringify({ session_id: "sess-abc123def", cwd: "/work/shop", transcript_path: transcript, hook_event_name: event, ...input }),
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const assistant = (id: string) =>
  `${JSON.stringify({ type: "assistant", message: { id, model: "claude-opus-5-5", usage: { input_tokens: 2000, output_tokens: 300 } } })}\n`;
let turn = 0;
function toolCall(event: "PostToolUse" | "PostToolUseFailure", input: Record<string, unknown>) {
  writeFileSync(transcript, assistant(`m${++turn}`), { flag: "a" });
  return hook(event, { tool_use_id: `t${turn}`, ...input });
}
const failingRun = (n: number) => toolCall("PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "python -m unittest" }, error: `Exit code 1\n${UNITTEST_FAIL.replace("{N}", String(n))}` });
const edit = (from: string, to: string) =>
  toolCall("PostToolUse", { tool_name: "Edit", tool_input: { file_path: "/work/shop/payments.py", old_string: from, new_string: to }, tool_response: { filePath: "/work/shop/payments.py" } });

before(async () => {
  port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  writeFileSync(transcript, "");
  env = { ...process.env, COURTROOM_PORT: String(port), COURTROOM_HOME: home, COURT_MOCK: "1", COURTROOM_DASHBOARD_URL: "http://localhost:3000" };
  delete env.ANTHROPIC_API_KEY;
  delete env.GROQ_API_KEY;
});

after(async () => {
  const token = readFileSync(join(home, "token"), "utf8").trim();
  await fetch(`${base()}/shutdown`, { method: "POST", headers: { "X-Courtroom-Token": token } }).catch(() => undefined);
});

test("a looping Claude Code session gets a COURT ORDER from the mock court", async () => {
  const start = hook("SessionStart", { source: "startup" });
  assert.match(start.systemMessage, /Courtroom is supervising this session/);
  assert.match(start.hookSpecificOutput.additionalContext, /COURT ORDER/);
  assert.equal(hook("UserPromptSubmit", { prompt: "Make the failing tests pass" }), null);

  // Rerunning the suite after each payments.py tweak, always with the same failure.
  assert.equal(failingRun(4), null);
  assert.equal(edit("timeout=3", "timeout=10"), null);
  assert.equal(failingRun(6), null);
  assert.equal(edit("timeout=10", "timeout=30"), null);
  const out = failingRun(5); // third identical result: the looping check fires
  assert.ok(out, "expected a ruling on the third identical test run");
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUseFailure");
  assert.match(out.hookSpecificOutput.additionalContext, /^COURT ORDER from the Courtroom \(case [\w-]+\), after a looping charge: /);
  assert.match(out.systemMessage, /COURT ORDER \(change strategy, looping charge\)/);
  assert.match(out.systemMessage, /http:\/\/localhost:3000\/court\//);

  const history = (await (await fetch(`${base()}/history`)).json()) as { type: string; data: any }[];
  const events = history.filter((m) => m.type === "event").map((m) => m.data);
  assert.deepEqual(events.map((e) => e.tool), ["run_tests", "edit_file", "run_tests", "edit_file", "run_tests"]);
  assert.equal(events[0].result, "10/11 passing; failing: test_checkout_charges_the_gateway — urllib.error.URLError: <urlopen error [Errno 61] Connection refused>");
  assert.ok(events.every((e) => e.error === undefined), "a failing test run is not a tool error");
  assert.ok(Math.abs(events[0].costUsd - (2000 * 4 + 300 * 20) / 1e6) < 1e-9, "each event carries its turn's cost");

  const charge = history.find((m) => m.type === "charge")!.data;
  assert.equal(charge.kind, "looping");
  assert.deepEqual(charge.eventIds, [events[0].id, events[2].id, events[4].id]);
  const verdict = history.find((m) => m.type === "verdict")!.data;
  assert.equal(verdict.verdict.ruling, "change_strategy");
  assert.ok(history.some((m) => m.type === "trial" && m.data.id === verdict.caseId));
  const states = history.filter((m) => m.type === "worker").map((m) => m.data.state);
  assert.ok(states.includes("on_trial") && states.at(-1) === "running");
  const status = history.filter((m) => m.type === "worker").at(-1)!.data;
  assert.equal(status.task, "Make the failing tests pass");
  assert.match(status.workerId, /^claude-code:shop:sess-a/);

  const saved = await fetch(`${base()}/cases/${verdict.caseId}`);
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as { charge: { id: number } }).charge.id, charge.id);

  // After the ruling the window resets: the same failure once more is not a new charge.
  assert.equal(failingRun(7), null);
});

test("the dashboard's endpoints: CORS for localhost only, resolve needs an escalated worker", async () => {
  const ok = await fetch(`${base()}/cases`, { headers: { Origin: "http://localhost:3000" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const evil = await fetch(`${base()}/history`, { headers: { Origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const preflight = await fetch(`${base()}/workers/x/resolve`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
  assert.equal(preflight.status, 204);
  const workerId = ((await (await fetch(`${base()}/workers`)).json()) as { workerId: string }[])[0].workerId;
  const r = await fetch(`${base()}/workers/${encodeURIComponent(workerId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ruling: "continue", reasoning: "x", cited_events: [] }),
  });
  assert.equal(r.status, 409);
  const forged = await fetch(`${base()}/hook`, { method: "POST", body: JSON.stringify({ event: "SessionEnd", input: { session_id: "x" } }) });
  assert.equal(forged.status, 401);
});

test("/stream opens immediately and replays history", async () => {
  const t0 = Date.now();
  const res = await fetch(`${base()}/stream`, { signal: AbortSignal.timeout(3000) });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  assert.ok(Date.now() - t0 < 1500);
  assert.match(new TextDecoder().decode(value), /^id: 1\ndata: \{"type":"worker"/);
  await reader.cancel();
});

test("SessionEnd closes the worker out", async () => {
  hook("SessionEnd", { reason: "exit" });
  const history = (await (await fetch(`${base()}/history`)).json()) as { type: string; data: any }[];
  const last = history.filter((m) => m.type === "worker").at(-1)!.data;
  assert.equal(last.state, "failed");
  assert.equal(last.summary, "Session ended at step 6 with 10/11 passing");
  assert.ok(last.endedAt);
});
