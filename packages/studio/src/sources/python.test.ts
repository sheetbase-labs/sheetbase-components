import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpSource, type HttpSource } from './http'
import { MemorySource } from './memory'

/**
 * Cross-language contract test: the Python/Ibis server and the in-memory
 * reference must answer the same requests the same way. Runs when
 * SHEETBASE_PYTHON points at a Python with `sheetbase-studio` installed.
 */
const PYTHON = process.env.SHEETBASE_PYTHON
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/filter-parity.json', import.meta.url)), 'utf8')) as {
  now: string
  fields: { id: string; dataType: 'text' | 'number' | 'boolean' | 'date' | 'datetime' }[]
  rows: Record<string, unknown>[]
  cases: { name: string; filter: GroupNode; expected: string[] }[]
}
const script = fileURLToPath(new URL('../../../../python/tests/support/serve_parity.py', import.meta.url))

describe.skipIf(!PYTHON)('Python server matches the in-memory reference', () => {
  let server: ChildProcess
  let http: HttpSource
  const memory = new MemorySource({ tables: [{ id: 'runs', rows: fixture.rows, fields: fixture.fields.map((field) => ({ ...field, label: field.id })) }], duckdb: false })
  const filter: GroupNode = { type: 'group', id: 'g', combinator: 'AND', children: [{ type: 'condition', id: 'c', field: 'result', operator: 'gte', value: 0 }] }

  beforeAll(async () => {
    const port = 18_700 + Math.floor(Math.random() * 500)
    server = spawn(PYTHON as string, [script, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve, reject) => {
      server.stdout?.on('data', (chunk: Buffer) => { if (chunk.toString().includes('Sheetbase Studio:')) resolve() })
      server.on('exit', (code) => reject(new Error(`Python server exited (${code})`)))
    })
    http = await createHttpSource({ baseUrl: `http://127.0.0.1:${port}` })
  }, 60_000)
  afterAll(() => { server?.kill() })

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
      right.buckets.forEach((bucket, index) => expect(bucket.value ?? Number.NaN).toBeCloseTo(left.buckets[index]?.value ?? Number.NaN, 9))
    }
  })

  it('profiles identically', async () => {
    const [left, right] = await Promise.all([memory.profile('runs', { fields: [], bins: 5, top: 3 }), http.profile('runs', { fields: [], bins: 5, top: 3 })])
    expect(right.totalRows).toBe(left.totalRows)
    for (const [index, profile] of left.profiles.entries()) {
      const other = right.profiles[index]
      expect({ field: other?.field, nulls: other?.nulls, distinct: other?.distinct, top: other?.top, counts: other?.histogram?.counts, min: other?.min, max: other?.max }, profile.field)
        .toEqual({ field: profile.field, nulls: profile.nulls, distinct: profile.distinct, top: profile.top, counts: profile.histogram?.counts, min: profile.min, max: profile.max })
    }
  })

  it('bins identically', async () => {
    const query = { field: 'count', bins: 6, by: 'passed', filter }
    const [left, right] = await Promise.all([memory.histogram('runs', query), http.histogram('runs', query)])
    expect(right).toEqual(left)
  })

  it('filters every parity case identically through the wire', async () => {
    for (const entry of fixture.cases.filter((item) => !JSON.stringify(item.filter).includes('withinLastDays'))) {
      const page = await http.page('runs', { rowStart: 0, rowCount: 50, fieldIds: ['id'], sort: [{ fieldId: 'id', direction: 'asc' }], filterTree: entry.filter })
      expect(page.records.map((record) => record.values.id), entry.name).toEqual(entry.expected)
    }
  })
})
