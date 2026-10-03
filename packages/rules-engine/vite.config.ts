import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: sheetbaseShared }] },
  server: {
    host: "0.0.0.0",
    port: 5202,
    strictPort: false,
  },
  preview: {
    port: 4202,
    strictPort: false,
  },
});
