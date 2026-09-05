import { bench, describe } from 'vitest'
import { decimatePoints } from './chart'
import { filteredRows, preparedRows, replicateSummary } from './explore'
import { inferColumns } from './schema'
import { sortRows } from './sort'
import type { ChartSpec, DataRow } from './types'

function makeRows(count: number): DataRow[] {
  return Array.from({ length: count }, (_, index) => ({
    group: `g${index % 50}`,
    value: (index * 48271) % 1000,
    label: `row-${index}`,
  }))
}

function makeDataset(count: number) {
  const rows = makeRows(count)
  return { name: 'bench', rows, columns: inferColumns(rows), source: 'bench' }
}

const base: ChartSpec = {
  kind: 'scatter', x: 'group', y: 'value', aggregate: 'none', showPoints: true, showGrid: true,
  pointSize: 5, pointOpacity: 0.9, lineWidth: 2, lineOpacity: 0.9,
  fillOpacity: 0.8, barGap: 2, barRadius: 3, barLayout: 'grouped', histogramBins: 12, palette: ['#000'],
}

const FILTERS = {
  ...base,
  filterLogic: 'and' as const,
  filters: [
    { id: '1', field: 'value', operator: 'gt' as const, value: '100' },
    { id: '2', field: 'label', operator: 'contains' as const, value: 'row-1' },
    { id: '3', field: 'group', operator: 'neq' as const, value: 'g7' },
  ],
}

describe('explorer data paths at 10k rows', () => {
  const data = makeDataset(10_000)

  bench('filter through three rules', () => { filteredRows(data, FILTERS) })
  bench('sort by value descending', () => { sortRows(data.rows, 'value', 'desc') })
  bench('aggregate into 50 groups with ci95', () => {
    preparedRows(data, { ...base, aggregate: 'mean', errorMode: 'ci95' })
  })
  bench('infer columns', () => { inferColumns(data.rows) })
  bench('summarise replicates', () => { replicateSummary(data, { ...base }) })
})

describe('explorer data paths at 100k rows', () => {
  const data = makeDataset(100_000)

  bench('filter through three rules', () => { filteredRows(data, FILTERS) })
  bench('sort by value descending', () => { sortRows(data.rows, 'value', 'desc') })
  bench('aggregate into 50 groups with ci95', () => {
    preparedRows(data, { ...base, aggregate: 'mean', errorMode: 'ci95' })
  })
  bench('infer columns', () => { inferColumns(data.rows) })
  bench('decimate to scatter budget', () => { decimatePoints(data.rows, 8000) })
})
