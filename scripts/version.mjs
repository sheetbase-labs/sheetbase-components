#!/usr/bin/env node
/**
 * Lockstep version bump: `bun scripts/version.mjs 0.2.0` rewrites the
 * `version` field of every packages/* manifest (libs and the private demo
 * stay on one release line) in place — only the version line is touched.
 * Inter-package deps are `workspace:*` and need no edits — `bun pm pack`
 * rewrites them to real versions at pack time.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packages = ["shared", "table", "advanced-search", "explorer", "schema-editor", "rules-engine", "studio", "studio-cli", "demo"];

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error("usage: bun scripts/version.mjs <semver>   e.g. 0.2.0 or 0.2.0-beta.1");
  process.exit(1);
}

for (const pkg of packages) {
  const file = join(root, "packages", pkg, "package.json");
  const text = readFileSync(file, "utf8");
  const bumped = text.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`);
  if (bumped === text) throw new Error(`${pkg}: no top-level version field found`);
  writeFileSync(file, bumped);
  const name = JSON.parse(text).name;
  console.log(`${name}: ${JSON.parse(text).version} → ${next}`);
}
// The Python package (python/) rides the same release line.
for (const [file, pattern, replacement] of [
  [join(root, "python", "pyproject.toml"), /^version = "[^"]+"/m, `version = "${next}"`],
  [join(root, "python", "src", "sheetbase", "__init__.py"), /^__version__ = "[^"]+"/m, `__version__ = "${next}"`],
]) {
  const text = readFileSync(file, "utf8");
  const bumped = text.replace(pattern, replacement);
  if (bumped === text) throw new Error(`${file}: no version line found`);
  writeFileSync(file, bumped);
  console.log(`${file.slice(root.length + 1)} → ${next}`);
}
console.log(`\nNext: update CHANGELOG.md, commit, tag v${next}, push — the release workflow publishes.`);
