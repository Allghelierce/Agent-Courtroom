// Prices a Claude Code session from its transcript (JSONL). Each call to read()
// returns the usage added since the last call, so each Event carries the cost of
// the model turn that produced it. Assistant messages repeat once per content
// block, so usage is counted once per message id.

import { openSync, readSync, closeSync, fstatSync } from "node:fs";

// shared/model-prices.json: USD per million tokens, [input, output, cacheWrite5m, cacheWrite1h, cacheRead].
export type PriceList = { models: Record<string, number[]> };

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

export type Delta = { tokens: number; costUsd: number; priced: boolean; model?: string };

export function priceFor(prices: PriceList, model: string): number[] | undefined {
  const id = model.replace(/\[.*\]$/, "");
  if (prices.models[id]) return prices.models[id];
  const key = Object.keys(prices.models).filter((k) => id.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? prices.models[key] : undefined;
}

export function usageCost(prices: PriceList, model: string, u: Usage): { tokens: number; costUsd: number; priced: boolean } {
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  const tokens = input + output + read + w5m + w1h;
  const p = priceFor(prices, model);
  if (!p) return { tokens, costUsd: 0, priced: false };
  const [pin, pout, p5m, p1h, pread] = p;
  return { tokens, costUsd: (input * pin + output * pout + w5m * p5m + w1h * p1h + read * pread) / 1e6, priced: true };
}

export class TranscriptMeter {
  private offset = 0;
  private partial = "";
  private seen = new Set<string>();

  constructor(private prices: PriceList) {}

  // For a session resumed after a daemon restart: what's already in the transcript was counted.
  skipToEnd(path: string | undefined): void {
    if (!path) return;
    try {
      const fd = openSync(path, "r");
      try {
        this.offset = fstatSync(fd).size;
      } finally {
        closeSync(fd);
      }
    } catch {
      // no transcript yet
    }
  }

  read(path: string | undefined): Delta {
    const delta: Delta = { tokens: 0, costUsd: 0, priced: true };
    if (!path) return { ...delta, priced: false };
    let chunk: string;
    try {
      const fd = openSync(path, "r");
      try {
        const size = fstatSync(fd).size;
        if (size < this.offset) this.offset = 0; // transcript rewritten (e.g. after /clear)
        const buf = Buffer.alloc(size - this.offset);
        readSync(fd, buf, 0, buf.length, this.offset);
        this.offset = size;
        chunk = this.partial + buf.toString("utf8");
      } finally {
        closeSync(fd);
      }
    } catch {
      return { ...delta, priced: false };
    }
    const lines = chunk.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: { type?: string; message?: { id?: string; model?: string; usage?: Usage } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const m = entry.message;
      if (entry.type !== "assistant" || !m?.usage || !m.model) continue;
      const id = m.id ?? line;
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      const c = usageCost(this.prices, m.model, m.usage);
      delta.tokens += c.tokens;
      delta.costUsd += c.costUsd;
      delta.priced &&= c.priced;
      delta.model = m.model;
    }
    return delta;
  }
}
