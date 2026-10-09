#!/usr/bin/env node
/**
 * Pack smoke: pack every publishable package, install the tarballs into a
 * scratch consumer, and typecheck an entry file that imports each one.
 * This is the test that catches manifest bugs (missing dist-types, wrong
 * exports, un-rewritten workspace: deps, missing peers) before publish.
 *
 * Usage: node scripts/pack-smoke.mjs [--skip-build]
 * Requires: bun (pack + install) and a network connection for peer deps.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const skipBuild = process.argv.includes("--skip-build");
const run = (cmd, args, cwd = root) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
};

const publishable = ["shared", "table", "advanced-search", "explorer", "schema-editor", "rules-engine"];

if (!skipBuild) run("bun", ["run", "build:lib"]);

const scratch = join(root, "node_modules", ".pack-smoke");
const tarballs = join(scratch, "tarballs");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(tarballs, { recursive: true });

// Pack in dependency order; the tarball name is name-version.tgz.
const packed = {};
for (const pkg of publishable) {
  const dir = join(root, "packages", pkg);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const out = execFileSync("bun", ["pm", "pack"], { cwd: dir, encoding: "utf8" });
  const file = out.split("\n").find((line) => line.trim().endsWith(".tgz"))?.trim();
  if (!file || !existsSync(join(dir, file))) throw new Error(`pack produced no tarball for ${pkg}`);
  const dest = join(tarballs, file);
  execFileSync("mv", [join(dir, file), dest]);
  packed[manifest.name] = dest;
  console.log(`packed ${manifest.name} -> ${file}`);
}

// A scratch consumer: real peers + every tarball, with overrides so the
// inter-package `workspace:*`→version deps resolve to the tarballs, not npm.
const deps = {
  react: "^19.1.0",
  "react-dom": "^19.1.0",
  "@tanstack/react-virtual": "^3.14.10",
  ...Object.fromEntries(Object.entries(packed).map(([name, file]) => [name, `file:${file}`])),
};
writeFileSync(join(scratch, "package.json"), JSON.stringify({
  name: "pack-smoke-consumer",
  private: true,
  dependencies: deps,
  overrides: Object.fromEntries(Object.keys(packed).map((name) => [name, `file:${packed[name]}`])),
  devDependencies: { typescript: "^5.7.2", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" },
}, null, 2));
writeFileSync(join(scratch, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    strict: true, noEmit: true, module: "esnext", moduleResolution: "bundler",
    jsx: "react-jsx", target: "es2022", skipLibCheck: false,
  },
  include: ["smoke.tsx"],
}));

writeFileSync(join(scratch, "smoke.tsx"), `
import { buildPredicate, toFieldDataType } from "@sheetbase-labs/sheetbase-shared";
import { createMemoryPagedAdapter, DataPageCache } from "@sheetbase-labs/sheetbase-table";
import { AdvancedSearch } from "@sheetbase-labs/sheetbase-advanced-search";
import { App as Explorer } from "@sheetbase-labs/sheetbase-explorer";
import { SchemaEditor } from "@sheetbase-labs/sheetbase-schemaeditor";
import { RulesEngine, ruleWritesForRows } from "@sheetbase-labs/sheetbase-rulesengine";

export const smoke = {
  buildPredicate, toFieldDataType, createMemoryPagedAdapter, DataPageCache,
  AdvancedSearch, Explorer, SchemaEditor, RulesEngine, ruleWritesForRows,
};
export const element = <AdvancedSearch />;
`);

run("bun", ["install"], scratch);
run("bun", ["x", "tsc", "-p", "tsconfig.json"], scratch);
console.log("\npack smoke passed: all tarballs install and typecheck as a consumer.");
