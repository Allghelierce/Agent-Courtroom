// Bundles the hook and the daemon (with the court and its SDKs) into dist/, so the
// installed plugin needs only Node: no npm install. Uses court/'s dev dependencies.
// `node build.mjs <dir>` writes elsewhere (test/dist.test.ts compares it with dist/).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "dist"));

const require = createRequire(new URL("../court/package.json", import.meta.url));
const esbuild = require("esbuild");

mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: { hook: join(here, "src/hook.ts"), daemon: join(here, "src/daemon.ts") },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // Some bundled SDK code still calls require(); give ESM output a real one.
  banner: { js: "import { createRequire as __courtroomRequire } from 'node:module'; const require = __courtroomRequire(import.meta.url);" },
});
copyFileSync(join(here, "../shared/model-prices.json"), join(out, "model-prices.json"));
console.log(`built ${out}: hook.mjs, daemon.mjs, model-prices.json`);
