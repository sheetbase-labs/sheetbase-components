import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-lib",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "sheetbase-advanced-search",
      cssFileName: "style",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "@sheetbase-labs/sheetbase-shared", "@sheetbase-labs/sheetbase-table"],
    },
  },
});
