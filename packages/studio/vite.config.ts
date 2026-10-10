import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const workspaceAliases = [
  { find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: local("../shared/src/index.ts") },
  { find: /^@sheetbase-labs\/sheetbase-table$/, replacement: local("../table/src/index.ts") },
  { find: /^@sheetbase-labs\/sheetbase-explorer$/, replacement: local("../explorer/src/index.ts") },
  { find: /^@sheetbase-labs\/sheetbase-advanced-search$/, replacement: local("../advanced-search/src/index.ts") },
];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  // DuckDB-WASM ships its own workers and wasm; pre-bundling would break their URLs.
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Native DuckDB in tests: forks keep its threads out of vitest's worker pool.
    pool: "forks",
    testTimeout: 30_000,
  },
  server: { host: "0.0.0.0", port: 5204, strictPort: false },
  preview: { port: 4204, strictPort: false },
});
