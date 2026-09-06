import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
