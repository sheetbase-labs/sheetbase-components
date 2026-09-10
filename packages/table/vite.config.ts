import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Resolve sheetbase-shared from source in the monorepo (see its compiled exports).
const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^sheetbase-shared$/, replacement: sheetbaseShared }] },
  server: {
    host: "0.0.0.0",
    // `PORT` overrides the default 5173; the CLI `--port` flag still wins.
    // `SHEETBASE_API_PORT` must match the example API (see `bun run dev:api`).
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      "/api/table": { target: `http://127.0.0.1:${process.env.SHEETBASE_API_PORT ?? 8787}`, changeOrigin: false },
      "/api/presentation": { target: `http://127.0.0.1:${process.env.SHEETBASE_API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
});
