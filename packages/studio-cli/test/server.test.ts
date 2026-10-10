import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpSource, type HttpSource } from '../../studio/src/sources/http'
import { MemorySource } from '../../studio/src/sources/memory'
import { DuckDbSource } from '@sheetbase-labs/sheetbase-studio/node'
import { createNativeEngine } from '../src/engine'
import { PAGE_MAX, createStudioHandler, type UiAssets } from '../src/handler'
import { openStudio, type OpenedStudio } from '../src/studio'
import { excelFixture, extensionPath, hasExtension, inProcessFetch, makeFixtures } from './support'

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../studio/fixtures/filter-parity.json', import.meta.url)), 'utf8')) as {
  fields: { id: string; dataType: 'text' | 'number' | 'boolean' | 'date' | 'datetime' }[]
  rows: Record<string, unknown>[]
  cases: { name: string; filter: GroupNode; expected: string[] }[]
}

describe('opening files and databases', () => {
  let fixtures: Awaited<ReturnType<typeof makeFixtures>>
  let studio: OpenedStudio

  beforeAll(async () => {
    fixtures = await makeFixtures()
    studio = await openStudio({
      files: [fixtures.dir, excelFixture],
      databases: [join(fixtures.dir, 'warehouse.duckdb'), ...(hasExtension('sqlite_scanner') ? [join(fixtures.dir, 'lims.sqlite')] : [])],
      extensionPath,
    })
  })
  afterAll(() => {
    studio?.close()
    fixtures?.cleanup()
  })

  it('lists every file (folders expanded, Excel per sheet) and database table', async () => {
    const ids = (await studio.source.catalog()).map((table) => table.id)
    expect(ids).toEqual(expect.arrayContaining(['big', 'notes', 'runs', 'wells', 'runs_runs', 'runs_plates', 'qc_assays', 'main_batches']))
    if (hasExtension('sqlite_scanner')) expect(ids).toContain('assays')
    expect(ids).not.toContain('ignored_txt')
  })

  it('counts files now and database tables on first use', async () => {
    const tables = await studio.source.catalog()
    expect(tables.find((table) => table.id === 'big')?.rowCount).toBe(1000)
    expect(tables.find((table) => table.id === 'qc_assays')?.rowCount).toBeNull()
    const page = await studio.source.page('qc_assays', { rowStart: 0, rowCount: 3, fieldIds: ['batch', 'titer'], sort: [{ fieldId: 'titer', direction: 'desc' }] })
    expect(page.totalRows).toBe(40)
    expect(page.records[0]?.values).toEqual({ batch: 'B1004', titer: 58.5 })
  })

  it.skipIf(!hasExtension('sqlite_scanner'))('reads SQLite through the bundled connector', async () => {
    const result = await studio.source.aggregate('assays', { groupBy: 'batch', summary: 'count' })
    expect(result.totalRows).toBe(500)
    expect(result.buckets).toHaveLength(7)
  })

  it('locks the engine down after opening', async () => {
    const attempts = [
      "SELECT * FROM read_csv('/etc/passwd')",
      "SELECT * FROM read_csv('https://example.com/x.csv')",
      'SET enable_external_access = true',
      "ATTACH '/tmp/other.duckdb' AS other",
      'INSERT INTO qc_assays VALUES (1)',
    ]
    for (const sql of attempts) await expect(studio.source.sql(sql), sql).rejects.toThrow()
    // Reading what was opened still works, including the Parquet view.
    const query = await studio.source.sql('SELECT count(*) AS n FROM big JOIN runs ON true')
    // Database tables are reachable in SQL by their catalog id.
    await expect(studio.source.sql('SELECT batch, count(*) AS n FROM qc_assays GROUP BY 1')).resolves.toMatchObject({ rowCount: 5 })
    expect(query.rowCount).toBe(1)
    await expect(studio.engine.query('SELECT count(*) AS n FROM big')).resolves.toEqual([{ n: 1000 }])
    await expect(studio.engine.exec("COPY (SELECT 1) TO '/tmp/sheetbase-leak.csv'")).rejects.toThrow(/disabled|Permission/i)
  })

  it('refuses --table selectors that match nothing', async () => {
    await expect(openStudio({ databases: [join(fixtures.dir, 'warehouse.duckdb')], tables: ['nope'], extensionPath })).rejects.toThrow(/No table matches --table nope/)
  })
})

describe('HTTP handler', () => {
  let fixtures: Awaited<ReturnType<typeof makeFixtures>>
  let studio: OpenedStudio
  let handler: (request: Request) => Promise<Response>
  const ui: UiAssets = {
    async get(path) {
      if (path === 'index.html') return { body: '<!doctype html><title>Studio</title>', type: 'text/html; charset=utf-8' }
      if (path === 'assets/app.js') return { body: 'console.log(1)', type: 'text/javascript; charset=utf-8' }
      return null
    },
  }
  const call = (path: string, init?: RequestInit & { host?: string }) => handler(new Request(`http://${init?.host ?? 'localhost:8765'}${path}`, init))

  beforeAll(async () => {
    fixtures = await makeFixtures()
    studio = await openStudio({ files: [join(fixtures.dir, 'runs.csv')], extensionPath })
    handler = createStudioHandler({ source: studio.source, upload: true, ui, allowedHosts: ['localhost', '127.0.0.1'] })
  })
  afterAll(() => {
    studio?.close()
    fixtures?.cleanup()
  })

  it('serves the catalog with capabilities', async () => {
    const response = await call('/api/studio/catalog')
    expect(response.status).toBe(200)
    const body = await response.json() as { source: { kind: string }; capabilities: { upload: boolean; sql: boolean }; tables: { id: string }[] }
    expect(body.source.kind).toBe('duckdb')
    expect(body.capabilities).toMatchObject({ upload: true, sql: true })
    expect(body.tables.map((table) => table.id)).toEqual(['runs'])
  })

  it('pages with filters and caps the page size', async () => {
    const tree: GroupNode = { type: 'group', id: 'g', combinator: 'AND', children: [{ type: 'condition', id: 'c', field: 'ok', operator: 'eq', value: true }] }
    const params = new URLSearchParams({ datasetId: 'runs', rowStart: '0', rowCount: String(PAGE_MAX * 10), fieldIds: 'batch,ok', filterTree: JSON.stringify(tree) })
    const body = await (await call(`/api/table/pages?${params}`)).json() as { totalRows: number; request: { rowCount: number }; records: { values: unknown }[] }
    expect(body.totalRows).toBe(2)
    expect(body.request.rowCount).toBe(PAGE_MAX)
    expect(body.records.map((record) => record.values)).toEqual([{ batch: 'B1', ok: true }, { batch: 'B3', ok: true }])
  })

  it('answers bad requests with JSON errors', async () => {
    expect((await call('/api/table/pages?datasetId=nope')).status).toBe(404)
    expect((await call('/api/table/pages?datasetId=runs&rowStart=-1')).status).toBe(400)
    expect((await call('/api/table/pages?datasetId=runs&sort=%7Bbad')).status).toBe(400)
    expect((await call('/api/studio/profile', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await call('/api/studio/nope', { method: 'POST', body: '{}' })).status).toBe(404)
    const sql = await call('/api/studio/sql', { method: 'POST', body: JSON.stringify({ sql: 'DROP TABLE runs' }) })
    expect(sql.status).toBe(400)
    expect(await sql.json()).toEqual({ error: expect.stringMatching(/read-only/) })
  })

  it('accepts uploads as multipart form data', async () => {
    const form = new FormData()
    form.append('file', new File(['well,od\nA1,0.3\n'], 'plate 7.csv', { type: 'text/csv' }))
    const response = await call('/api/studio/upload', { method: 'POST', body: form })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ tables: [{ id: 'plate_7', rowCount: 1 }] })
  })

  it('serves the UI as a single-page app with caching for hashed assets', async () => {
    const page = await call('/some/deep/link')
    expect(page.headers.get('content-type')).toMatch(/text\/html/)
    expect(await page.text()).toContain('<title>Studio</title>')
    const asset = await call('/assets/app.js')
    expect(asset.headers.get('cache-control')).toMatch(/immutable/)
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await call('/../../etc/passwd')).headers.get('content-type')).toMatch(/text\/html/)
  })

  it('refuses other hosts (DNS rebinding) and checks the token', async () => {
    expect((await call('/api/studio/catalog', { host: 'attacker.example:8765' })).status).toBe(421)
    const guarded = createStudioHandler({ source: studio.source, upload: false, token: 's3cret-token' })
    const at = (path: string, headers: Record<string, string> = {}) => guarded(new Request(`http://localhost${path}`, { headers }))
    expect((await at('/api/studio/catalog')).status).toBe(401)
    expect((await at('/api/studio/catalog?token=wrong-token!')).status).toBe(401)
    expect((await at('/api/studio/catalog?token=s3cret-token')).status).toBe(200)
    expect((await at('/api/studio/catalog', { authorization: 'Bearer s3cret-token' })).status).toBe(200)
    const upload = await guarded(new Request('http://localhost/api/studio/upload?token=s3cret-token', { method: 'POST', body: new FormData() }))
    expect(upload.status).toBe(403)
  })
})

describe('native server matches the in-memory reference', () => {
  let http: HttpSource
  let close: () => void
  const memory = new MemorySource({ tables: [{ id: 'runs', rows: fixture.rows, fields: fixture.fields.map((field) => ({ ...field, label: field.id })) }], duckdb: false })
  const filter: GroupNode = { type: 'group', id: 'g', combinator: 'AND', children: [{ type: 'condition', id: 'c', field: 'result', operator: 'gte', value: 0 }] }

  beforeAll(async () => {
    const engine = await createNativeEngine()
    const source = await DuckDbSource.create({ engine, id: 'local', label: 'native', kind: 'duckdb' })
    await source.addRows(fixture.rows, { id: 'runs', name: 'runs', fields: fixture.fields.map((field) => ({ ...field, label: field.id })) })
    await engine.lockDown()
    const handler = createStudioHandler({ source, upload: false })
    http = await createHttpSource({ baseUrl: 'http://localhost', fetcher: inProcessFetch(handler) })
    close = () => engine.close()
  })
  afterAll(() => close?.())

  it('pages identically', async () => {
    const query = { rowStart: 0, rowCount: 20, fieldIds: fixture.fields.map((field) => field.id), sort: [{ fieldId: 'id', direction: 'asc' as const }], filterTree: filter }
    const [left, right] = await Promise.all([memory.page('runs', query), http.page('runs', query)])
    expect(right.totalRows).toBe(left.totalRows)
    expect(right.records).toEqual(left.records)
  })

  it('aggregates identically', async () => {
    for (const summary of ['count', 'mean', 'median', 'sum', 'min', 'max'] as const) {
      const query = { groupBy: 'status', seriesBy: ['passed'], summary, valueField: summary === 'count' ? undefined : 'result', filter }
      const [left, right] = await Promise.all([memory.aggregate('runs', query), http.aggregate('runs', query)])
      expect(right.totalRows, summary).toBe(left.totalRows)
      expect(right.buckets.map(({ key, series, count }) => ({ key, series, count })), summary).toEqual(left.buckets.map(({ key, series, count }) => ({ key, series, count })))
      for (const [index, bucket] of right.buckets.entries()) expect(bucket.value ?? Number.NaN).toBeCloseTo(left.buckets[index]?.value ?? Number.NaN, 9)
    }
  })

  it('bins identically', async () => {
    const query = { field: 'count', bins: 6, by: 'passed', filter }
    expect(await http.histogram('runs', query)).toEqual(await memory.histogram('runs', query))
  })

  it('filters every parity case identically through the wire', async () => {
    for (const entry of fixture.cases.filter((item) => !JSON.stringify(item.filter).includes('withinLastDays'))) {
      const page = await http.page('runs', { rowStart: 0, rowCount: 50, fieldIds: ['id'], sort: [{ fieldId: 'id', direction: 'asc' }], filterTree: entry.filter })
      expect(page.records.map((record) => record.values.id), entry.name).toEqual(entry.expected)
    }
  })
})
