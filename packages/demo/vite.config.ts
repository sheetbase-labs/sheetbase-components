import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sibling = (dir: string, entry = "src/index.ts") =>
  fileURLToPath(new URL(`../${dir}/${entry}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Sibling packages publish built libs only; the demo resolves their sources
  // directly so a fresh clone needs no `build:lib` pass (mirrors tsconfig paths).
  resolve: {
    alias: [
      { find: /^sheetbase-table$/, replacement: sibling("table") },
      { find: /^sheetbase-explorer$/, replacement: sibling("explorer") },
      { find: /^sheetbase-schemaeditor$/, replacement: sibling("schema-editor") },
      { find: /^sheetbase-rulesengine$/, replacement: sibling("rules-engine") },
      { find: /^sheetbase-advanced-search$/, replacement: sibling("advanced-search") },
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
