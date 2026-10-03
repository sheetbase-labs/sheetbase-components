import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-lib",
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "sheetbase-table", cssFileName: "style" },
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-virtual", "@sheetbase-labs/sheetbase-shared"] },
  },
});
