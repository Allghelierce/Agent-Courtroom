// dist/ is committed (installs don't build) and bundles court/src, so it goes stale
// whenever the court or the plugin changes. Fix with `npm run build`, then commit dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = new URL("../", import.meta.url).pathname;

test("dist/ matches a fresh build (run `npm run build` and commit dist/ if this fails)", () => {
  const fresh = mkdtempSync(join(tmpdir(), "courtroom-build-"));
  execFileSync(process.execPath, [join(plugin, "build.mjs"), fresh]);
  for (const f of ["hook.mjs", "daemon.mjs", "model-prices.json"]) {
    const same = readFileSync(join(plugin, "dist", f)).equals(readFileSync(join(fresh, f)));
    assert.ok(same, `dist/${f} is stale: run \`cd plugin && npm run build\` and commit dist/`);
  }
});
