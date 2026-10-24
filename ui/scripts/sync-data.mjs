// Refreshes the UI's bundled demo data from ../court: copies the fixture runs and re-runs a mock
// trial on each one. Run it whenever court/fixtures changes:  npm run sync-data
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..");
const court = join(ui, "..", "court");
const RUNS = ["looping", "stalling", "overspend", "false-alarm"];

for (const name of RUNS) {
  const fixture = join(court, "fixtures", `${name}-run.json`);
  copyFileSync(fixture, join(ui, "data", "runs", `${name}-run.json`));
  const out = mkdtempSync(join(tmpdir(), "trial-"));
  execFileSync("npx", ["tsx", "src/cli.ts", fixture, "--mock", "--save", out], { cwd: court, stdio: "ignore" });
  const [saved] = readdirSync(out).filter((f) => f.endsWith(".json"));
  renameSync(join(out, saved), join(ui, "data", "cases", `${name}.json`));
  rmSync(out, { recursive: true });
  console.log(`synced ${name}`);
}
