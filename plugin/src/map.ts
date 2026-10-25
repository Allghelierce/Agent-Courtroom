// Turns one Claude Code tool call into the engine's Event fields, using the engine's
// tool names (read_file, edit_file, run_tests) so the court's prompts and mock read it
// the same way. Results are normalized (timings, timestamps, addresses stripped) so a
// repeated call with the same outcome compares equal, which is what looping keys on.

import { relative, isAbsolute } from "node:path";
import { firstFailure, parseTestRun, stripAnsi, type TestRun } from "./progress.ts";

export type HookToolInput = {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  error?: string;
  is_interrupt?: boolean;
  cwd?: string;
};

export type Mapped = {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  error?: string;
  tests?: TestRun;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function normalize(s: string): string {
  return stripAnsi(s)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, "<time>")
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|secs|seconds|m)\b/g, "<t>")
    .replace(/\b0x[0-9a-f]{6,}\b/gi, "0x…")
    .replace(/\s+/g, " ")
    .trim();
}

function rel(path: unknown, cwd?: string): string {
  const p = String(path ?? "");
  if (!cwd || !isAbsolute(p)) return p;
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r : p;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(text).join("\n");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("stdout" in o || "stderr" in o) return [o.stdout, o.stderr].map(text).filter(Boolean).join("\n");
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (typeof o.result === "string") return o.result;
    return JSON.stringify(o);
  }
  return String(v);
}

function lastLine(s: string): string {
  const lines = stripAnsi(s).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

function compactArgs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === "string" ? clip(v, 200) : v;
  return out;
}

export function testsResult(run: TestRun, output: string): string {
  let s = `${run.passing}/${run.total} passing`;
  if (run.failing.length) s += `; failing: ${run.failing.join(", ")}`;
  const why = run.passing < run.total ? firstFailure(output) : null;
  if (why) s += ` — ${normalize(why)}`;
  return s;
}

export function mapToolCall(h: HookToolInput): Mapped {
  const input = h.tool_input ?? {};
  const failed = h.error !== undefined || h.is_interrupt === true;
  const output = failed ? `${h.error ?? ""}\n${text(h.tool_response)}` : text(h.tool_response);
  const errorText = h.is_interrupt ? "interrupted by the user" : clip(normalize(h.error ?? ""), 240);

  switch (h.tool_name) {
    case "Read":
      return withError(failed, errorText, {
        tool: "read_file",
        args: { path: rel(input.file_path, h.cwd), ...(input.offset != null ? { offset: input.offset } : {}), ...(input.limit != null ? { limit: input.limit } : {}) },
        result: `read ${readLines(h.tool_response)} lines`,
      });
    case "Edit":
      return withError(failed, errorText, {
        tool: "edit_file",
        args: { path: rel(input.file_path, h.cwd), old_str: clip(String(input.old_string ?? ""), 300), new_str: clip(String(input.new_string ?? ""), 300) },
        result: `edited ${rel(input.file_path, h.cwd)}`,
      });
    case "MultiEdit":
      return withError(failed, errorText, {
        tool: "edit_file",
        args: { path: rel(input.file_path, h.cwd), edits: Array.isArray(input.edits) ? input.edits.length : 0 },
        result: `edited ${rel(input.file_path, h.cwd)}`,
      });
    case "Write":
      return withError(failed, errorText, {
        tool: "edit_file",
        args: { path: rel(input.file_path, h.cwd), chars: String(input.content ?? "").length },
        result: `wrote ${rel(input.file_path, h.cwd)}`,
      });
    case "Bash": {
      const command = clip(String(input.command ?? ""), 300);
      const run = parseTestRun(output);
      // A failing test suite is a result, not a tool error (engine convention).
      if (run) return { tool: "run_tests", args: { command }, result: testsResult(run, output), tests: run };
      if (failed) return { tool: "bash", args: { command }, result: errorText, error: errorText };
      return { tool: "bash", args: { command }, result: clip(normalize(lastLine(output)) || "ok, no output", 200) };
    }
    case "Grep":
    case "Glob": {
      const r = (h.tool_response ?? {}) as Record<string, unknown>;
      const n = r.numFiles ?? r.numMatches ?? r.numLines ?? (Array.isArray(r.filenames) ? r.filenames.length : undefined);
      return withError(failed, errorText, {
        tool: h.tool_name.toLowerCase(),
        args: compactArgs(input),
        result: n != null ? `${n} ${h.tool_name === "Glob" ? "files" : "matches"}` : clip(normalize(text(h.tool_response)), 200),
      });
    }
    default:
      return withError(failed, errorText, {
        tool: h.tool_name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
        args: compactArgs(input),
        result: clip(normalize(text(h.tool_response)), 200) || "ok",
      });
  }
}

function withError(failed: boolean, errorText: string, m: Mapped): Mapped {
  return failed ? { ...m, result: errorText, error: errorText } : m;
}

function readLines(resp: unknown): number {
  const r = (resp ?? {}) as Record<string, unknown>;
  const file = (r.file ?? r) as Record<string, unknown>;
  if (typeof file.numLines === "number") return file.numLines;
  const content = typeof file.content === "string" ? file.content : text(resp);
  return content ? content.split("\n").length : 0;
}
