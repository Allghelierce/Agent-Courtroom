// A daemon that restarts mid-session (killed, or replaced by a new build) only learns about a session from the
// stream log. Its SessionEnd must still close the session out, or the dashboard shows it working forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type HookInput } from "../src/daemon.ts";

const session = (id: string): HookInput => ({ session_id: id, cwd: "/work/shop" }) as HookInput;
const statuses = (history: { type: string; data: unknown }[], sessionId: string) =>
  history.filter((m) => m.type === "worker").map((m) => m.data as { workerId: string; state: string; endedAt?: string; summary?: string }).filter((s) => s.workerId.endsWith(sessionId.slice(0, 6)));

test("SessionEnd closes out a session the daemon only knows from its stream log", async () => {
  const home = mkdtempSync(join(tmpdir(), "courtroom-restart-"));
  const first = createDaemon({ home, mock: true });
  await first.handleHook("SessionStart", session("abc123-live"));
  await first.handleHook("PostToolUse", { ...session("abc123-live"), tool_name: "Read", tool_input: { file_path: "/work/shop/cart.py" }, tool_response: {} } as HookInput);

  const second = createDaemon({ home, mock: true }); // the old daemon is gone; this one rebuilds from stream.jsonl
  await second.handleHook("SessionEnd", session("abc123-live"));

  const last = statuses(second.history, "abc123-live").at(-1)!;
  assert.equal(last.state, "succeeded");
  assert.equal(last.summary, "Session ended at step 1");
  assert.ok(last.endedAt);
});

test("/stream opens right away even with nothing to replay", async () => {
  // A fresh daemon (or one whose history was wiped) has nothing to send yet; the dashboard must still see it's up.
  const home = mkdtempSync(join(tmpdir(), "courtroom-restart-"));
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  const d = createDaemon({ home, port, mock: true });
  await d.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/stream`, { signal: AbortSignal.timeout(1500) });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    await res.body?.cancel();
  } finally {
    await d.close();
  }
});

test("SessionEnd for a session the daemon never saw adds nothing", async () => {
  const home = mkdtempSync(join(tmpdir(), "courtroom-restart-"));
  const d = createDaemon({ home, mock: true });
  await d.handleHook("SessionEnd", session("zzz999-unknown"));
  assert.deepEqual(statuses(d.history, "zzz999-unknown"), []);
});
