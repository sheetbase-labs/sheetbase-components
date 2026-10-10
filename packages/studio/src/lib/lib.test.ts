import type { AnalysisView, GroupNode, Layout, SheetbaseField, StudioDataSource, TableInfo } from '@sheetbase-labs/sheetbase-shared'
import { defaultChartSpec } from '@sheetbase-labs/sheetbase-explorer'
import { describe, expect, it } from 'vitest'
import { assignRole, chartForField } from './presets'
import { buildProvenance, readSvgProvenance, svgWithProvenance } from './provenance'
import { viewToIbis, viewToPandas, viewToSql } from './view-code'
import { percent } from '../ui/data'
import { LAYOUTS, layoutModeFor } from '../ui/layouts'

const fields: SheetbaseField[] = [
  { id: 'status', label: 'status', dataType: 'text' },
  { id: 'titer', label: 'titer', dataType: 'number' },
  { id: 'day', label: 'day', dataType: 'date' },
  { id: 'qc pass', label: 'qc pass', dataType: 'boolean' },
]
const filter: GroupNode = {
  type: 'group', id: 'g', combinator: 'AND', children: [
    { type: 'condition', id: 'a', field: 'status', operator: 'eq', value: "O'Brien" },
    { type: 'condition', id: 'b', field: 'titer', operator: 'between', value: [1, 2.5] },
    { type: 'group', id: 'n', combinator: 'NOT', children: [{ type: 'condition', id: 'c', field: 'qc pass', operator: 'eq', value: false }] },
  ],
}
const view: AnalysisView = { filter, summary: 'mean' }
const input = { table: 'runs', fields, view, chart: { x: 'status', y: 'titer' }, now: Date.parse('2026-03-15T12:00:00Z') }

describe('view as code', () => {
  it('writes readable SQL with escaped literals and an aggregate', () => {
    expect(viewToSql(input)).toBe([
      'SELECT "status", count(*) AS n, avg("titer") AS "mean_titer"',
      'FROM "runs"',
      'WHERE (lower("status") = \'o\'\'brien\' AND "titer" BETWEEN 1 AND 2.5 AND (NOT ("qc pass" = FALSE)))',
      'GROUP BY "status"',
      'ORDER BY "status"',
    ].join('\n'))
  })

  it('writes Ibis and pandas with column names that need quoting', () => {
    const ibis = viewToIbis(input)
    expect(ibis).toContain('_["qc pass"] == False')
    expect(ibis).toContain('_.titer.between(1, 2.5)')
    expect(ibis).toContain('.group_by(["status"]).agg(n=_.count(), mean_titer=_.titer.mean())')
    const pandas = viewToPandas({ ...input, view: { ...view, summary: 'count' } })
    expect(pandas).toContain('df["status"].astype("string").str.lower() == "o\'brien"')
    expect(pandas).toContain('.groupby(["status"], dropna=False).size().reset_index(name="n")')
  })

  it('writes a plain filtered select when nothing aggregates', () => {
    expect(viewToSql({ ...input, view: { filter: { type: 'group', id: 'r', combinator: 'AND', children: [] }, summary: 'none', sort: { field: 'day', direction: 'desc' }, limit: 10 } }))
      .toBe('SELECT *\nFROM "runs"\nORDER BY "day" DESC\nLIMIT 10')
  })
})

describe('chart presets', () => {
  const spec = { ...defaultChartSpec, x: undefined, y: undefined }
  const base: AnalysisView = { filter, summary: 'none' }
  it('charts a measure as a histogram and a category as counts', () => {
    expect(chartForField(fields[1] as SheetbaseField, undefined, spec, base)).toMatchObject({ spec: { kind: 'histogram', x: 'titer' }, view: { summary: 'none' } })
    expect(chartForField(fields[0] as SheetbaseField, { field: 'status', count: 10, nulls: 0, distinct: 3 }, spec, base)).toMatchObject({ spec: { kind: 'bar', x: 'status' }, view: { summary: 'count' } })
    expect(chartForField(fields[0] as SheetbaseField, { field: 'status', count: 99, nulls: 0, distinct: 40 }, spec, base).spec.kind).toBe('horizontal-bar')
    expect(chartForField(fields[2] as SheetbaseField, undefined, spec, base)).toMatchObject({ spec: { kind: 'line' }, view: { summary: 'count' } })
  })
  it('picks a kind for x/y pairs', () => {
    const byStatus = assignRole('x', fields[0] as SheetbaseField, fields, new Map(), { ...spec, y: 'titer' }, base)
    expect(byStatus.spec).toMatchObject({ x: 'status', kind: 'box' })
    const overTime = assignRole('y', fields[1] as SheetbaseField, fields, new Map(), { ...spec, x: 'day' }, base)
    expect(overTime).toMatchObject({ spec: { kind: 'line', y: 'titer' }, view: { summary: 'mean' } })
    expect(assignRole('color', fields[0] as SheetbaseField, fields, new Map(), { ...spec, color: 'status' }, base).spec.color).toBeUndefined()
  })
})

describe('provenance', () => {
  it('round-trips through an SVG export', () => {
    const table: TableInfo = { id: 'q', label: 'Query 1', rowCount: 3, kind: 'query', sql: 'SELECT 1 AS "a<b>"', fields: [] }
    const source = { id: 'py', label: 'Python', kind: 'python' } as StudioDataSource
    const record = buildProvenance({ source, table, view, query: { filterTree: filter }, chart: { kind: 'bar' }, sql: 'SELECT …', matchingRows: 2, now: new Date('2026-03-15T00:00:00Z') })
    const svg = svgWithProvenance('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>', record)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><metadata')).toBe(true)
    expect(readSvgProvenance(svg)).toEqual(record)
    expect(record.table.sql).toBe('SELECT 1 AS "a<b>"')
  })
})

describe('percent', () => {
  it('never rounds missing values away', () => {
    expect(percent(995, 1000)).toBe('99.5%')
    expect(percent(9990, 10000)).toBe('99.9%')
    expect(percent(99999, 100000)).toBe('>99.9%')
    expect(percent(1000, 1000)).toBe('100%')
    expect(percent(960, 1000)).toBe('96%')
    expect(percent(5, 100)).toBe('5.0%')
    expect(percent(0, 0)).toBe('—')
  })
})

describe('layout modes', () => {
  it('picks a layout from the body size', () => {
    expect(layoutModeFor(1376, 830)).toBe('wide')
    expect(layoutModeFor(1376, 599)).toBe('short')
    expect(layoutModeFor(1376, 333)).toBe('short')
    expect(layoutModeFor(780, 320)).toBe('short')
    expect(layoutModeFor(1376, 299)).toBe('narrow')
    expect(layoutModeFor(759, 1000)).toBe('narrow')
  })

  it('places every pane in every layout', () => {
    const ids = (node: Layout): string[] => (node === null ? [] : node.kind === 'stack' ? [...node.panes] : node.children.flatMap(ids))
    for (const layout of Object.values(LAYOUTS)) expect(ids(layout).sort()).toEqual(['chart', 'fields', 'filters', 'sql', 'table'])
  })
})
