import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-lib",
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "sheetbase-studio", cssFileName: "style" },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@tanstack/react-virtual",
        "@sheetbase-labs/sheetbase-shared",
        "@sheetbase-labs/sheetbase-table",
        "@sheetbase-labs/sheetbase-explorer",
        "@sheetbase-labs/sheetbase-advanced-search",
        // Loaded lazily on first SQL/upload; the host's bundler resolves them.
        "@duckdb/duckdb-wasm",
        "read-excel-file/browser",
      ],
    },
  },
});
