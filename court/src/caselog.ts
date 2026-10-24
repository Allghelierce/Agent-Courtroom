// File-backed case log: one JSON file per trial. Person C's event server can
// replace this; until then the UI can read court/cases/*.json.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Trial } from "./types.ts";

export async function saveTrial(trial: Trial, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${trial.id}.json`);
  await writeFile(path, `${JSON.stringify(trial, null, 2)}\n`);
  return path;
}

export async function listTrials(dir: string): Promise<Trial[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const trials = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map(async (n) => JSON.parse(await readFile(join(dir, n), "utf8")) as Trial),
  );
  return trials.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
