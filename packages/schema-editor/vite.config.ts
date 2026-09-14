import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sheetbaseShared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

/**
 * `sheetbase-shared` resolves to workspace source so dev and build both see the
 * sibling package directly. Serving that source unbundled costs ~20 separate
 * module requests though, and imports are only discovered level by level: on a
 * high-latency link (the orb portal, ~250ms RTT) each level serialises and the
 * library alone added ~1.2s to first paint.
 *
 * The dep optimizer is therefore pointed at the library entry, so dev fetches
 * one pre-bundled module instead of the whole source graph. Vite caches it in
 * `node_modules/.vite/deps`; restart the dev server after editing shared
 * source (or use `bun run build:lib` as the sibling examples do).
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^sheetbase-shared$/, replacement: sheetbaseShared }] },
  optimizeDeps: {
    // Linked workspace packages are skipped by default — opt this one in.
    include: ["sheetbase-shared"],
  },
  server: {
    host: "0.0.0.0",
    port: 5201,
    strictPort: false,
  },
  preview: {
    port: 4201,
    strictPort: false,
  },
});
