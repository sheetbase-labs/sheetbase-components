import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serverOnlyAliases } from "./vite.standalone.config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** One self-contained ES module (plus CSS) for the anywidget front end. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: serverOnlyAliases },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: local("../../python/src/sheetbase/static/widget"),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000,
    lib: { entry: local("./src/widget/index.tsx"), formats: ["es"], fileName: () => "widget.js", cssFileName: "widget" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
