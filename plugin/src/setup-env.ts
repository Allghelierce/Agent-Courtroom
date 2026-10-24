// Imported first by the daemon: the court reads COURT_PRICES_PATH when its module loads,
// so point it at the price list shipped next to the bundle before anything else runs.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundled = fileURLToPath(new URL("./model-prices.json", import.meta.url));
if (!process.env.COURT_PRICES_PATH && existsSync(bundled)) process.env.COURT_PRICES_PATH = bundled;
