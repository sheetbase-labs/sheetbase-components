import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { plainValue, type FileSqlEngine } from '../sources/duckdb-wasm'

/** Native DuckDB for tests — the same SQL the WASM engine runs in the browser. */
export async function createNodeEngine(): Promise<FileSqlEngine & { close(): void }> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const dir = mkdtempSync(join(tmpdir(), 'sheetbase-studio-'))
  return {
    async query(sql) {
      const reader = await connection.runAndReadAll(sql)
      return reader.getRowObjectsJS().map((row) => plainValue(row) as Record<string, unknown>)
    },
    async registerFile(name, data) {
      const path = join(dir, name)
      writeFileSync(path, data)
      return path
    },
    async dropFile(path) {
      rmSync(path, { force: true })
    },
    close() {
      connection.closeSync()
      instance.closeSync()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
