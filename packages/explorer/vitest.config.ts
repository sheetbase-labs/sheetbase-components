import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sheetbaseShared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
const sheetbaseTable = fileURLToPath(new URL('../table/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^sheetbase-shared$/, replacement: sheetbaseShared },
      { find: /^sheetbase-table$/, replacement: sheetbaseTable },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
