import { createRequire as __courtroomRequire } from 'node:module'; const require = __courtroomRequire(import.meta.url);

// src/hook.ts
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
var event = process.argv[2] ?? "";
var port = Number(process.env.COURTROOM_PORT || 4300);
var base = `http://127.0.0.1:${port}`;
var debug = (msg) => process.env.COURTROOM_DEBUG && process.stderr.write(`courtroom: ${msg}
`);
async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}
async function health() {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
    const body = await res.json().catch(() => ({}));
    return body.service === "courtroom-plugin" ? "ours" : "other";
  } catch {
    return "none";
  }
}
var home = process.env.COURTROOM_HOME ?? join(homedir(), ".claude-courtroom");
async function ensureDaemon() {
  const state = await health();
  if (state !== "none") return state === "ours";
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, "daemon.log"), "a");
  const daemon = fileURLToPath(new URL("./daemon.mjs", import.meta.url));
  spawn(process.execPath, [daemon], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await health() === "ours") return true;
  }
  return false;
}
async function main() {
  if (process.env.COURTROOM_DISABLED === "1") return;
  const input = JSON.parse(await readStdin() || "{}");
  if (!event || !input.session_id) return debug("not called as a Claude Code hook");
  if (!await ensureDaemon()) return debug(`no courtroom daemon on port ${port}`);
  const res = await fetch(`${base}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Courtroom-Token": readFileSync(join(home, "token"), "utf8").trim() },
    body: JSON.stringify({ event, input }),
    signal: AbortSignal.timeout(11e4)
  });
  const { output } = await res.json();
  if (output) process.stdout.write(`${JSON.stringify(output)}
`);
}
main().catch((err) => debug(err.message)).finally(() => process.stdout.write("", () => process.exit(0)));
