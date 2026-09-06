import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
