import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sheetbaseShared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^sheetbase-shared$/, replacement: sheetbaseShared }] },
  server: {
    port: 5199,
    strictPort: false,
  },
  preview: {
    port: 4199,
    strictPort: false,
  },
})
