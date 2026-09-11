import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";

const budgetSource = readFileSync(new URL("./budget.env", import.meta.url), "utf8");
const budgetBytes = Number(budgetSource.match(/BUNDLE_BUDGET_BYTES=(\d+)/)?.[1] ?? 0);
const bundle = new URL("../dist-lib/sheetbase-explorer.js", import.meta.url);
if (!budgetBytes) {
  console.error("bundle-budget: BUNDLE_BUDGET_BYTES is missing from scripts/budget.env");
  process.exit(1);
}
if (!existsSync(bundle)) {
  console.error("bundle-budget: dist-lib/sheetbase-explorer.js not found — run `bun run build:lib` first");
  process.exit(1);
}

const gzipped = gzipSync(readFileSync(bundle)).length;
const rounded = Math.round(gzipped / 100) / 10;
const limit = Math.round(budgetBytes / 100) / 10;
console.log(`bundle-budget: ${rounded} kB gzip (budget ${limit} kB)`);
if (gzipped > budgetBytes) {
  console.error(`bundle-budget: exceeded — ${rounded} kB > ${limit} kB. Raise scripts/budget.env deliberately.`);
  process.exit(1);
}
