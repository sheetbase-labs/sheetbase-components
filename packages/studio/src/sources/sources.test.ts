import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { GroupNode, StudioDataSource } from '@sheetbase-labs/sheetbase-shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNodeEngine } from '../test/node-engine'
import { DuckDbSource } from './file'
import { MemorySource } from './memory'
import { cleanStatement } from './sql-source'

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/filter-parity.json', import.meta.url)), 'utf8')) as {
  fields: { id: string; dataType: 'text' | 'number' | 'boolean' | 'date' | 'datetime' }[]
  rows: Record<string, unknown>[]
}
const fields = fixture.fields.map((field) => ({ ...field, label: field.id }))
const filter: GroupNode = {
  type: 'group', id: 'g', combinator: 'AND', children: [
    { type: 'condition', id: 'c', field: 'result', operator: 'gte', value: 0 },
  ],
}

function file(name: string, content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
}

describe('memory and DuckDB sources agree', () => {
  const closers: (() => void)[] = []
  let memory: MemorySource
  let duck: DuckDbSource

  beforeAll(async () => {
    memory = new MemorySource({
      tables: [{ id: 'runs', rows: fixture.rows, fields }],
      duckdb: async () => { const engine = await createNodeEngine(); closers.push(engine.close); return engine },
    })
    const engine = await createNodeEngine()
    closers.push(engine.close)
    duck = await DuckDbSource.create({ engine })
    await duck.addRows(fixture.rows, { name: 'runs', id: 'runs', fields })
  })
  afterAll(() => { for (const close of closers) close() })

  const both = (): [string, StudioDataSource][] => [['memory', memory], ['duckdb', duck]]

  it('catalogs the table with its declared types', async () => {
    for (const [, source] of both()) {
      const [table] = await source.catalog()
      expect(table?.id).toBe('runs')
      expect(table?.rowCount).toBe(fixture.rows.length)
      expect(table?.fields.map((field) => [field.id, field.dataType])).toEqual(fixture.fields.map((field) => [field.id, field.dataType]))
    }
  })

  it('pages with the same rows, values and totals', async () => {
    const pages = await Promise.all(both().map(([, source]) => source.page('runs', {
      rowStart: 1, rowCount: 4, fieldIds: ['id', 'result', 'passed', 'collected', 'measured_at'],
      sort: [{ fieldId: 'result', direction: 'desc' }], filterTree: filter,
    })))
    expect(pages[0]?.totalRows).toBe(8)
    expect(pages[1]).toEqual(pages[0])
  })

  it('aggregates with the same buckets', async () => {
    for (const summary of ['count', 'mean', 'median', 'sum', 'min', 'max'] as const) {
      const results = await Promise.all(both().map(([, source]) => source.aggregate('runs', {
        groupBy: 'status', seriesBy: ['passed'], summary, valueField: summary === 'count' ? undefined : 'result', filter,
      })))
      expect(results[1], summary).toEqual(results[0])
    }
  })

  it('profiles every field the same way', async () => {
    const [left, right] = await Promise.all(both().map(([, source]) => source.profile?.('runs', { fields: [], bins: 5, top: 3 })))
    expect(left?.totalRows).toBe(10)
    for (const [index, profile] of (left?.profiles ?? []).entries()) {
      const other = right?.profiles[index]
      expect(other?.field).toBe(profile.field)
      expect(other?.nulls, profile.field).toBe(profile.nulls)
      expect(other?.distinct, profile.field).toBe(profile.distinct)
      expect(other?.top, profile.field).toEqual(profile.top)
      expect(other?.histogram?.counts, profile.field).toEqual(profile.histogram?.counts)
      expect(other?.min, profile.field).toEqual(profile.min)
      expect(other?.max, profile.field).toEqual(profile.max)
      if (profile.mean !== undefined) {
        expect(other?.mean).toBeCloseTo(profile.mean ?? 0, 9)
        expect(other?.std).toBeCloseTo(profile.std ?? 0, 9)
        expect(other?.quantiles?.p50).toBeCloseTo(profile.quantiles?.p50 ?? 0, 9)
        expect(other?.quantiles?.p95).toBeCloseTo(profile.quantiles?.p95 ?? 0, 9)
      }
    }
    const result = left?.profiles.find((profile) => profile.field === 'result')
    expect(result?.nulls).toBe(1)
    expect(result?.min).toBe(-1.25)
    expect(result?.max).toBe(1e6)
  })

  it('bins histograms identically, with and without a series', async () => {
    for (const by of [undefined, 'passed']) {
      const [left, right] = await Promise.all(both().map(([, source]) => source.histogram?.('runs', { field: 'count', bins: 6, by, filter })))
      expect(right).toEqual(left)
      expect(left?.edges).toHaveLength(7)
    }
    const dates = await memory.histogram('runs', { field: 'collected', bins: 4 })
    expect(dates.nulls).toBe(1)
    expect(dates.series[0]?.counts.reduce((sum, count) => sum + count, 0)).toBe(9)
  })

  it('samples deterministically within the filter', async () => {
    for (const [, source] of both()) {
      const first = await source.sample?.('runs', { fields: ['id', 'result'], n: 3, filter, seed: 7 })
      const second = await source.sample?.('runs', { fields: ['id', 'result'], n: 3, filter, seed: 7 })
      expect(first?.rows).toHaveLength(3)
      expect(first?.sampled).toBe(true)
      expect(first?.totalRows).toBe(8)
      expect(second?.rows).toEqual(first?.rows)
      expect(first?.rows.every((row) => typeof row.result === 'number' && row.result >= 0)).toBe(true)
    }
    const all = await memory.sample('runs', { fields: ['id'], n: 50 })
    expect(all.sampled).toBe(false)
    expect(all.rows).toHaveLength(10)
  })

  it('runs read-only SQL as a new explorable table', async () => {
    const info = await memory.sql('SELECT status, avg(result) AS mean_result, count(*) AS n FROM runs GROUP BY status ORDER BY status;')
    expect(info.kind).toBe('query')
    expect(info.fields.map((field) => [field.id, field.dataType])).toEqual([['status', 'text'], ['mean_result', 'number'], ['n', 'number']])
    expect((await memory.catalog()).map((table) => table.id)).toEqual(['runs', info.id])
    const page = await memory.page(info.id, { rowStart: 0, rowCount: 50, fieldIds: [] })
    expect(page.totalRows).toBe(info.rowCount)
    const profile = await memory.profile(info.id, { fields: ['n'] })
    expect(profile.profiles[0]?.min).toBe(1)
  })

  it('refuses anything that is not a query', async () => {
    await expect(memory.sql('DROP TABLE runs')).rejects.toThrow(/read-only/)
    await expect(memory.sql('SELECT 1; DROP TABLE runs')).rejects.toThrow()
    await expect(memory.sql('WITH x AS (SELECT 1) DELETE FROM runs')).rejects.toThrow()
    expect((await memory.page('runs', { rowStart: 0, rowCount: 1, fieldIds: ['id'] })).totalRows).toBe(10)
    expect(cleanStatement('  -- note\nSELECT 1 ;; ')).toBe('-- note\nSELECT 1')
  })

  it('ingests CSV, TSV, JSON and Parquet uploads with typed columns', async () => {
    const [csv] = await duck.upload(file('Bioreactor Runs.csv', 'run,ph,ok,day\nA,7.1,true,2026-01-02\nB,6.9,false,2026-01-03\n'))
    expect(csv?.id).toBe('bioreactor_runs')
    expect(csv?.fields.map((field) => field.dataType)).toEqual(['text', 'number', 'boolean', 'date'])
    const [tsv] = await duck.upload(file('plate.tsv', 'well\tod\nA1\t0.5\nA2\t0.7\n'))
    expect(tsv?.rowCount).toBe(2)
    const [json] = await duck.upload(file('runs.json', JSON.stringify([{ a: 1 }, { a: 2 }])))
    expect(json?.id).toBe('runs_2')
    // Write a Parquet file with DuckDB itself, then upload its bytes.
    const engine = duck.engine as Awaited<ReturnType<typeof createNodeEngine>>
    const path = await engine.registerFile('out.parquet', new Uint8Array())
    await engine.query(`COPY (SELECT range AS i, range * 0.5 AS x FROM range(100)) TO '${path}' (FORMAT parquet)`)
    const [parquet] = await duck.upload(file('measurements.parquet', readFileSync(path)))
    expect(parquet?.rowCount).toBe(100)
    expect((await duck.aggregate(parquet?.id ?? '', { groupBy: 'i', summary: 'sum', valueField: 'x', limit: 2 })).buckets).toEqual([
      { key: '0', count: 1, value: 0 },
      { key: '1', count: 1, value: 0.5 },
    ])
    await expect(duck.upload(file('notes.docx', 'x'))).rejects.toThrow(/Unsupported file type/)
  })
})
