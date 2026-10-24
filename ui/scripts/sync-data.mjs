// Refreshes the UI's bundled demo from ../court: the 4-worker stream and a mock trial for each of its charges.
// Run it whenever court/fixtures/stream-demo-4workers.jsonl or the court's mock changes:  npm run sync-data
// With real models instead of the mock (needs GROQ_API_KEY or ANTHROPIC_API_KEY):  npm run sync-data -- --real
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("npx", ["tsx", join(ui, "scripts", "build-stream-trials.mts"), ...process.argv.slice(2)], { cwd: join(ui, "..", "court"), stdio: "inherit" });
