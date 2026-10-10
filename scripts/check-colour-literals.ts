/**
 * COMP-01: fail on new literal colours in package source.
 *
 * Every package must render its colours through the theme variables (see
 * `packages/shared/src/theme.css` and `themes/v3.css`), so a host can retheme it
 * to UI system v3 by loading a preset and mapping its own variables onto them.
 *
 * Scanned: TSX/TS/CSS in table, explorer, advanced-search, shared and studio. Skipped:
 *   - `themes/` directories and `theme.css` — the preset/definition files,
 *     which are the sanctioned home for literal token values;
 *   - `dist`/`dist-lib`/`dist-types` build output;
 *   - `*.test.*` and `*.bench.*` — they never render.
 * The only literal allowed in source is the `rgb(0 0 0 / x%)` box-shadow /
 * border elevation.
 *
 *   bun run check:colours
 */
import { Glob } from "bun";

const PATTERNS = [
  "packages/table/src/**/*.ts",
  "packages/table/src/**/*.tsx",
  "packages/table/src/**/*.css",
  "packages/explorer/src/**/*.ts",
  "packages/explorer/src/**/*.tsx",
  "packages/explorer/src/**/*.css",
  "packages/advanced-search/src/**/*.ts",
  "packages/advanced-search/src/**/*.tsx",
  "packages/advanced-search/src/**/*.css",
  "packages/shared/src/**/*.ts",
  "packages/shared/src/**/*.tsx",
  "packages/shared/src/**/*.css",
  "packages/studio/src/**/*.ts",
  "packages/studio/src/**/*.tsx",
  "packages/studio/src/**/*.css",
];

const SKIP = [
  /\/themes\//,
  /\/theme\.css$/,
  /\.(test|bench)\./,
  /\/dist[^/]*\//,
];

const ALLOWED_SHADOW = /rgba?\(\s*0\s+0\s+0\s*\/\s*[\d.]+%?\s*\)/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;

const findings: Array<{ file: string; line: number; rule: string }> = [];

for (const pattern of PATTERNS) {
  for await (const file of new Glob(pattern).scan(".")) {
    if (SKIP.some((skip) => skip.test(file))) continue;
    const lines = (await Bun.file(file).text())
      .replace(ALLOWED_SHADOW, "")
      .split("\n");
    lines.forEach((line, index) => {
      if (HEX.test(line)) findings.push({ file, line: index + 1, rule: "hex colour" });
      if (RGB.test(line)) findings.push({ file, line: index + 1, rule: "rgb() colour" });
    });
  }
}

if (findings.length > 0) {
  console.error(
    "COMP-01: literal colour in package source — use a theme variable (var(--token)); the only allowed literal is rgb(0 0 0 / x%) elevation.\n",
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`);
  }
  console.error(`\n${findings.length} finding(s).`);
  process.exit(1);
}
console.log("No literal colours in package source (CSS, TS and TSX).");
