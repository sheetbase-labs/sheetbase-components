import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { duckdbPlatform } from '../src/platform'

const cliRoot = fileURLToPath(new URL('..', import.meta.url))

/** Extensions fetched by `bun run fetch:natives` (CI fetches them before tests). */
export const extensionDir = process.env.SHEETBASE_DUCKDB_EXTENSIONS ?? join(cliRoot, '.cache', 'natives', 'v1.5.5', duckdbPlatform(), 'extensions')
export const hasExtension = (name: string) => existsSync(join(extensionDir, `${name}.duckdb_extension`))
export const extensionPath = async (name: string) => {
  const path = join(extensionDir, `${name}.duckdb_extension`)
  if (!existsSync(path)) throw new Error(`missing ${path}`)
  return path
}

export const excelFixture = join(cliRoot, 'test', 'fixtures', 'runs.xlsx')

/** A scratch directory with CSV, TSV, JSON, Parquet, DuckDB and (when the extension is present) SQLite files. */
export async function makeFixtures(): Promise<{ dir: string; cleanup(): void }> {
  const dir = mkdtempSync(join(tmpdir(), 'sheetbase-cli-test-'))
  writeFileSync(join(dir, 'runs.csv'), 'batch,titer,day,ok\nB1,1.25,2026-03-01,true\nB2,2.5,2026-03-02,false\nB3,,2026-03-03,true\n')
  writeFileSync(join(dir, 'wells.tsv'), 'well\tod\nA1\t0.31\nA2\t0.29\n')
  writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ batch: 'B1', note: 'ok' }, { batch: 'B2', note: 'repeat' }]))
  writeFileSync(join(dir, 'ignored.txt.bak'), 'not data')
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const q = (sql: string) => connection.run(sql)
  await q(`COPY (SELECT range AS id, range * 0.5 AS value FROM range(1000)) TO '${join(dir, 'big.parquet')}' (FORMAT parquet)`)
  await q(`ATTACH '${join(dir, 'warehouse.duckdb')}' AS wh`)
  await q('CREATE SCHEMA wh.qc')
  await q("CREATE TABLE wh.qc.assays AS SELECT 'B' || (1000 + range % 5) AS batch, range * 1.5 AS titer FROM range(40)")
  await q("CREATE TABLE wh.main.batches AS SELECT 'B' || (1000 + range) AS batch, 'AAV9' AS product FROM range(5)")
  await q('DETACH wh')
  if (hasExtension('sqlite_scanner')) {
    await q(`LOAD '${join(extensionDir, 'sqlite_scanner.duckdb_extension')}'`)
    await q(`ATTACH '${join(dir, 'lims.sqlite')}' AS lims (TYPE sqlite)`)
    await q("CREATE TABLE lims.assays AS SELECT range AS id, 'B' || (1000 + range % 7) AS batch, 1 + range * 0.1 AS titer FROM range(500)")
    await q('DETACH lims')
  }
  connection.closeSync()
  instance.closeSync()
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A `fetch` that calls a handler in-process — the real wire format without a socket. */
export function inProcessFetch(handler: (request: Request) => Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch
}
