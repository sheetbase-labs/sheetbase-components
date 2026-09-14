#!/usr/bin/env node
/**
 * Bundled dev mode: build the app, watch it, and serve the bundle.
 *
 * The regular dev server (`bun run dev`) serves unbundled ES modules — ~24
 * requests spread over ~6 import levels. On a high-latency link every level
 * serialises, so the orb portal (~250ms RTT to the dev server) spent ~1.75s
 * before first paint; the same app as a bundle is ~3 requests and ~0.6s.
 * The portal therefore uses this mode, while `bun run dev` keeps HMR for local
 * work. It serves the production-shaped bundle (no HMR, no React dev
 * warnings); edits rebuild automatically — reload the page to pick them up.
 *
 * Usage: node scripts/dev-bundled.mjs [vite preview flags]
 *   node scripts/dev-bundled.mjs --config vite.orb.config.ts --host 0.0.0.0 --port 5201 --strictPort
 *
 * `--config` is shared with the build; every flag is forwarded to
 * `vite preview`. Output goes to dist-dev/ so the production `dist/` stays put.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));
const outDir = "dist-dev";
const args = process.argv.slice(2);

const log = (message) => console.log(`[dev:bundled] ${message}`);

function viteBinary() {
  for (const candidate of [join(packageRoot, "node_modules", ".bin", "vite"), join(repoRoot, "node_modules", ".bin", "vite")]) {
    if (existsSync(candidate)) return candidate;
  }
  return "bunx";
}

function viteArgs(subcommand) {
  const bin = viteBinary();
  return bin === "bunx" ? ["vite", subcommand] : [subcommand];
}

/** `--config <path>` / `--config=<path>` applies to the build as well as preview. */
function configArgs() {
  const config = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--config" && args[i + 1]) { config.push("--config", args[i + 1]); i += 1; }
    else if (args[i].startsWith("--config=")) config.push(args[i]);
  }
  return config;
}

const children = new Set();
function shutdown(code) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const bin = viteBinary();
const buildArgs = [
  ...viteArgs("build"),
  "--watch",
  "--outDir", outDir,
  "--emptyOutDir",
  ...configArgs(),
];
log(`building with ${bin === "bunx" ? "bunx vite" : bin}: ${buildArgs.join(" ")}`);
const buildProcess = spawn(bin, buildArgs, { cwd: packageRoot, stdio: ["ignore", "inherit", "inherit"] });
children.add(buildProcess);

const previewArgs = [...viteArgs("preview"), "--outDir", outDir, ...args];
const previewProcess = { current: null };

buildProcess.on("exit", (code) => {
  if (previewProcess.current) previewProcess.current.kill("SIGTERM");
  log(`build watcher exited with code ${code ?? "unknown"}`);
  process.exit(code ?? 1);
});

/** Start preview once the first build has written its entry HTML. */
const started = Date.now();
const readyTimer = setInterval(() => {
  const ready = existsSync(join(packageRoot, outDir, "index.html"));
  if (!ready && Date.now() - started < 60_000) return;
  clearInterval(readyTimer);
  if (!ready) {
    log(`timed out waiting for ${outDir}/index.html`);
    shutdown(1);
    return;
  }
  log(`serving ${outDir} with ${bin === "bunx" ? "bunx vite" : bin}: ${previewArgs.join(" ")}`);
  const preview = spawn(bin, previewArgs, { cwd: packageRoot, stdio: ["ignore", "inherit", "inherit"] });
  previewProcess.current = preview;
  children.add(preview);
  preview.on("exit", (code) => {
    log(`preview exited with code ${code ?? "unknown"}`);
    shutdown(code ?? 0);
  });
}, 200);
