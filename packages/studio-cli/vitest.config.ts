import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: local("../shared/src/index.ts") },
      { find: /^@sheetbase-labs\/sheetbase-studio\/node$/, replacement: local("../studio/src/node.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Native DuckDB: forks keep its threads out of vitest's worker pool.
    pool: "forks",
    testTimeout: 60_000,
  },
});
