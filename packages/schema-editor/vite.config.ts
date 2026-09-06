import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5201,
    strictPort: false,
  },
  preview: {
    port: 4201,
    strictPort: false,
  },
  test: { environment: "node" },
});
