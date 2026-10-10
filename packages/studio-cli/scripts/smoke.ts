/**
 * Smoke-test a built binary on the machine it targets:
 *
 *   bun scripts/smoke.ts [path/to/sheetbase-studio]
 *
 * Starts it with an empty cache against generated files, a DuckDB file and a
 * SQLite file (plus Postgres/MySQL when SHEETBASE_TEST_POSTGRES /
 * SHEETBASE_TEST_MYSQL are set), then checks the catalog, paging,
 * aggregation, SQL, the read-only lockdown, uploads and the UI.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtures } from '../test/support'
import { cliRoot, hostTarget } from './natives'

const version = (await Bun.file(join(cliRoot, 'package.json')).json() as { version: string }).version
const target = hostTarget()
const binary = process.argv[2] ?? join(cliRoot, 'dist', `sheetbase-studio-${version}-${target.duckdb}${process.platform === 'win32' ? '.exe' : ''}`)
if (!existsSync(binary)) throw new Error(`No binary at ${binary}; build it first.`)

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
  if (ok) return
  failures++
  // In CI, each failure is also an annotation, readable from the run summary.
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=smoke: ${label}::${`${label}${detail ? ` — ${detail}` : ''}`.replace(/%/g, '%25').replace(/\r?\n/g, '%0A').slice(0, 900)}`)
}

const cache = mkdtempSync(join(tmpdir(), 'sheetbase-smoke-cache-'))
const env = { ...process.env, SHEETBASE_CACHE_DIR: cache }

const versionRun = spawnSync(binary, ['--version'], { env, encoding: 'utf8' })
check('--version', versionRun.status === 0 && versionRun.stdout.startsWith('sheetbase-studio '), versionRun.stderr || versionRun.stdout)

const fixtures = await makeFixtures()
const databases = [join(fixtures.dir, 'warehouse.duckdb'), join(fixtures.dir, 'lims.sqlite')]
if (process.env.SHEETBASE_TEST_POSTGRES) databases.push(`pg=${process.env.SHEETBASE_TEST_POSTGRES}`)
if (process.env.SHEETBASE_TEST_MYSQL) databases.push(`my=${process.env.SHEETBASE_TEST_MYSQL}`)
const args = [join(fixtures.dir, 'runs.csv'), join(fixtures.dir, 'big.parquet'), ...databases.flatMap((db) => ['--db', db]), '--no-browser', '--port', '0']
const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
const url = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`No URL after 60s:\n${output}`)), 60_000)
  const read = (chunk: Buffer) => {
    output += chunk.toString()
    const match = /running at (http:\/\/\S+)/.exec(output)
    if (match?.[1]) {
      clearTimeout(timer)
      resolve(match[1])
    }
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.on('exit', (code) => reject(new Error(`Exited (${code}) before serving:\n${output}`)))
})
console.log(output.trim())
const base = new URL(url)
const api = (path: string, init?: RequestInit) => fetch(new URL(path, base), init)
const post = (path: string, body: unknown) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

try {
  const catalog = await (await api('/api/studio/catalog')).json() as { tables: { id: string; rowCount: number | null }[]; capabilities: { upload: boolean } }
  const ids = catalog.tables.map((table) => table.id)
  for (const id of ['runs', 'big', 'qc_assays', 'main_batches', 'assays']) check(`catalog has ${id}`, ids.includes(id), ids.join(', '))
  if (process.env.SHEETBASE_TEST_POSTGRES || process.env.SHEETBASE_TEST_MYSQL) check('catalog has the live database tables', ids.some((id) => id.includes('studio_assays')), ids.join(', '))

  const page = await (await api('/api/table/pages?datasetId=big&rowStart=10&rowCount=2&fieldIds=id,value')).json() as { totalRows: number; records: { values: Record<string, unknown> }[] }
  check('pages Parquet', page.totalRows === 1000 && page.records[0]?.values.id === 10, JSON.stringify(page).slice(0, 200))

  const groups = await (await post('/api/explorer/aggregate', { datasetId: 'assays', groupBy: 'batch', summary: 'count' })).json() as { totalRows: number; buckets: unknown[] }
  check('aggregates SQLite', groups.totalRows === 500 && groups.buckets.length === 7, JSON.stringify(groups).slice(0, 200))

  const sql = await post('/api/studio/sql', { sql: 'SELECT batch, sum(titer) AS t FROM qc_assays GROUP BY 1' })
  const sqlBody = await sql.json() as { kind?: string; rowCount?: number }
  check('runs read-only SQL over a DuckDB file', sql.ok && sqlBody.kind === 'query' && sqlBody.rowCount === 5, JSON.stringify(sqlBody))

  const outside = process.platform === 'win32' ? 'C:\\\\Windows\\\\win.ini' : '/etc/hosts'
  const denied = await post('/api/studio/sql', { sql: `SELECT * FROM read_csv('${outside}')` })
  check('refuses files it was not given', denied.status === 400 && /disabled|Permission/i.test(JSON.stringify(await denied.json())))

  const form = new FormData()
  form.append('file', new File(['well,od\nA1,0.3\nA2,0.4\n'], 'plate.csv', { type: 'text/csv' }))
  const upload = await (await api('/api/studio/upload', { method: 'POST', body: form })).json() as { tables?: { id: string; rowCount: number }[] }
  check('accepts uploads', upload.tables?.[0]?.rowCount === 2, JSON.stringify(upload))

  const page404 = await api('/api/table/pages?datasetId=nope')
  check('unknown tables are 404', page404.status === 404)

  const ui = await api('/')
  const html = await ui.text()
  check('serves the UI', ui.ok && /<div id="root">/.test(html), html.slice(0, 120))
  const script = /src="\.?\/?(assets\/[^"]+\.js)"/.exec(html)?.[1]
  check('serves UI assets', Boolean(script) && (await api(`/${script}`)).ok)
} finally {
  // Wait for the server to exit before cleaning up: Windows keeps the
  // unpacked DuckDB DLL locked until the process is gone.
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once('exit', () => resolve())
  })
  child.kill()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))])
  for (const [label, remove] of [['fixtures', () => fixtures.cleanup()], ['cache', () => rmSync(cache, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })]] as const) {
    try {
      remove()
    } catch (error) {
      console.warn(`(couldn't remove the ${label} directory: ${error instanceof Error ? error.message : String(error)})`)
    }
  }
}

if (failures) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=smoke: server output::${output.replace(/%/g, '%25').replace(/\r?\n/g, '%0A').slice(0, 1800)}`)
  console.error(`\n${failures} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all checks passed')
