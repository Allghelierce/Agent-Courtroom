// Env reads where blank means unset: a stray `NAME=` line in a .env file must fall back to
// the default, not become "" or 0.
export function envStr(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function envNum(name: string, fallback: number, min = 0): number {
  const v = Number(envStr(name));
  return envStr(name) !== undefined && Number.isFinite(v) && v >= min ? v : fallback;
}
