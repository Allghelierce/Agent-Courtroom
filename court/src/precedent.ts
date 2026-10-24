import type { EvidencePacket, Trial } from "./types.ts";

export type PrecedentOptions = {
  now?: number; // ms since epoch; defaults to Date.now()
  recentMs?: number; // skip the same worker's trials newer than this (default 2 minutes)
};

// A matching charge kind always outranks text overlap, which is at most 1.
const KIND_WEIGHT = 2;
const RECENT_MS = 2 * 60 * 1000;
const STOPWORDS = new Set(["the", "and", "for", "with", "got", "expected", "last", "steps", "times", "same", "first", "failing"]);

// Lowercased words of 3+ chars, without pure numbers or filler words.
export function tokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

// The packet's error and charge text against the past trial's charge summary.
// The prosecution argument is included because it quotes the error the worker hit.
function overlap(packet: EvidencePacket, t: Trial): number {
  const mine = tokens(`${packet.stats.lastError ?? ""} ${packet.charge.summary}`);
  const theirs = tokens(`${t.charge.summary} ${t.prosecution?.argument ?? ""}`);
  return jaccard(mine, theirs);
}

// Past trials most like this case, best first. Skips the same worker's very recent
// trials (those are the case itself or its immediate retry, not precedent).
export function findPrecedents(packet: EvidencePacket, past: Trial[], k = 3, opts: PrecedentOptions = {}): Trial[] {
  const now = opts.now ?? Date.now();
  const recentMs = opts.recentMs ?? RECENT_MS;

  return past
    .filter((t) => !(t.workerId === packet.workerId && now - Date.parse(t.finishedAt) < recentMs))
    .map((t) => ({ t, score: (t.charge.kind === packet.charge.kind ? KIND_WEIGHT : 0) + overlap(packet, t) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.t.finishedAt) - Date.parse(a.t.finishedAt))
    .slice(0, Math.max(0, k))
    .map((s) => s.t);
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/s);
  return (m ? m[0] : text).trim();
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// A short block for the Judge's prompt, or "" when there is nothing to cite.
export function renderPrecedents(ts: Trial[]): string {
  if (ts.length === 0) return "";
  const lines = ts.map((t) => {
    const gist = t.verdict.instruction?.trim() || firstSentence(t.verdict.reasoning);
    return `- ${t.id} (${t.charge.kind}, ${t.workerId}): ${t.verdict.ruling.toUpperCase()} — "${clip(gist)}"`;
  });
  return `PRECEDENTS:\n${lines.join("\n")}`;
}
