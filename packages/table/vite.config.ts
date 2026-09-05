import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api/table": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/api/presentation": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  test: { environment: "node" },
});
