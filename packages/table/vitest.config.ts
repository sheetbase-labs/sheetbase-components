import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^sheetbase-shared$/, replacement: sheetbaseShared }] },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
