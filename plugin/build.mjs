// Bundles the hook and the daemon (with the court and its SDKs) into dist/, so the
// installed plugin needs only Node: no npm install. Uses court/'s dev dependencies.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../court/package.json", import.meta.url));
const esbuild = require("esbuild");

mkdirSync("dist", { recursive: true });
await esbuild.build({
  entryPoints: { hook: "src/hook.ts", daemon: "src/daemon.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // Some bundled SDK code still calls require(); give ESM output a real one.
  banner: { js: "import { createRequire as __courtroomRequire } from 'node:module'; const require = __courtroomRequire(import.meta.url);" },
});
copyFileSync("../shared/model-prices.json", "dist/model-prices.json");
console.log("built dist/hook.mjs, dist/daemon.mjs, dist/model-prices.json");
