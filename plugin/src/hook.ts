// Entry point for every Claude Code hook: `node dist/hook.mjs <HookEvent>`, with the hook's
// JSON on stdin. Starts the courtroom daemon on first use, forwards the input to it, and
// prints the hook output it returns. Any failure exits 0 with no output, so the courtroom
// can never break a session.

import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const event = process.argv[2] ?? "";
const port = Number(process.env.COURTROOM_PORT || 4300);
const base = `http://127.0.0.1:${port}`;
const debug = (msg: string) => process.env.COURTROOM_DEBUG && process.stderr.write(`courtroom: ${msg}\n`);

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

// "ours" when the courtroom answers, "other" when something else holds the port, "none" when nothing does.
async function health(): Promise<"ours" | "other" | "none"> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
    const body = (await res.json().catch(() => ({}))) as { service?: string };
    return body.service === "courtroom-plugin" ? "ours" : "other";
  } catch {
    return "none";
  }
}

const home = process.env.COURTROOM_HOME ?? join(homedir(), ".claude-courtroom");

async function ensureDaemon(): Promise<boolean> {
  const state = await health();
  if (state !== "none") return state === "ours";
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, "daemon.log"), "a");
  const daemon = fileURLToPath(new URL("./daemon.mjs", import.meta.url));
  spawn(process.execPath, [daemon], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if ((await health()) === "ours") return true;
  }
  return false;
}

async function main() {
  if (process.env.COURTROOM_DISABLED === "1") return;
  const input = JSON.parse((await readStdin()) || "{}");
  if (!event || !input.session_id) return debug("not called as a Claude Code hook");
  if (!(await ensureDaemon())) return debug(`no courtroom daemon on port ${port}`);
  // A trial can take up to the court's deadline (50 s by default); hooks.json allows 120 s.
  const res = await fetch(`${base}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Courtroom-Token": readFileSync(join(home, "token"), "utf8").trim() },
    body: JSON.stringify({ event, input }),
    signal: AbortSignal.timeout(110_000),
  });
  const { output } = (await res.json()) as { output: unknown };
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

// Exit once stdout has flushed (pipe writes can be async), always with code 0.
main()
  .catch((err) => debug((err as Error).message))
  .finally(() => process.stdout.write("", () => process.exit(0)));
