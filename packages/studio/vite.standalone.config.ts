import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workspaceAliases } from "./vite.config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const noLocalEngine = local("./src/standalone/no-local-engine.ts");

/** Aliases for builds where the Python server does uploads and SQL. */
export const serverOnlyAliases = [
  ...workspaceAliases,
  { find: /^@duckdb\/duckdb-wasm$/, replacement: noLocalEngine },
  { find: /^hyparquet(-compressors)?$/, replacement: noLocalEngine },
  { find: /^read-excel-file\/browser$/, replacement: noLocalEngine },
];

/** The page `sheetbase serve` hosts, written into the Python package. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: serverOnlyAliases },
  base: "./",
  build: {
    outDir: local("../../python/src/sheetbase/static/app"),
    emptyOutDir: true,
    rollupOptions: { input: local("./standalone.html") },
  },
});
