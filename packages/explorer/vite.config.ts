import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sheetbaseShared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
const sheetbaseTable = fileURLToPath(new URL('../table/src/index.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@sheetbase-labs\/sheetbase-shared$/, replacement: sheetbaseShared },
      { find: /^@sheetbase-labs\/sheetbase-table$/, replacement: sheetbaseTable },
    ],
  },
  server: {
    port: 5199,
    strictPort: false,
  },
  preview: {
    port: 4199,
    strictPort: false,
  },
})
