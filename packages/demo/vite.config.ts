import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sibling = (dir: string, entry = "src/index.ts") =>
  fileURLToPath(new URL(`../${dir}/${entry}`, import.meta.url));

const build = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
  // Sibling packages publish built libs only; the demo resolves their sources
  // directly so a fresh clone needs no `build:lib` pass (mirrors tsconfig paths).
  resolve: {
    alias: [
      { find: /^@sheetbase-labs\/sheetbase-table$/, replacement: sibling("table") },
      { find: /^@sheetbase-labs\/sheetbase-explorer$/, replacement: sibling("explorer") },
      { find: /^@sheetbase-labs\/sheetbase-schemaeditor$/, replacement: sibling("schema-editor") },
      { find: /^@sheetbase-labs\/sheetbase-rulesengine$/, replacement: sibling("rules-engine") },
      { find: /^@sheetbase-labs\/sheetbase-advanced-search$/, replacement: sibling("advanced-search") },
      { find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: sibling("shared") },
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5205,
    strictPort: false,
  },
  preview: {
    port: 4205,
    strictPort: false,
  },
});
