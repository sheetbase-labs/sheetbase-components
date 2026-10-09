import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));
const sheetbaseTable = fileURLToPath(new URL("../table/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: sheetbaseShared },
      { find: /^@sheetbase-labs\/sheetbase-table$/, replacement: sheetbaseTable },
    ],
  },
  test: {
    // The e2e directory holds Playwright specs (`v3-filter.spec.ts`); keep them
    // out of the vitest run.
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
  server: {
    host: "0.0.0.0",
    port: 5203,
    strictPort: false,
  },
  preview: {
    port: 4203,
    strictPort: false,
  },
});
