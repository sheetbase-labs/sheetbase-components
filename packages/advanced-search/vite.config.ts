import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));
const sheetbaseTable = fileURLToPath(new URL("../table/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^sheetbase-shared$/, replacement: sheetbaseShared },
      { find: /^sheetbase-table$/, replacement: sheetbaseTable },
    ],
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
