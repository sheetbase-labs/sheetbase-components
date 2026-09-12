import { describe, expect, it } from 'vitest'
import { filteredRows, preparedRows, replicateSummary, ERROR_HIGH, ERROR_LOW, ROW_ID } from './explore'
import { inferColumns } from './schema'
import type { ChartSpec, DataRow, Dataset, FilterRule } from './types'

function dataset(rows: DataRow[]): Dataset {
  return { name: 'test', rows, columns: inferColumns(rows), source: 'test' }
}

function spec(partial: Partial<ChartSpec> = {}): ChartSpec {
  return {
    kind: 'scatter', aggregate: 'none', showPoints: true, showGrid: true,
    pointSize: 5, pointOpacity: 0.9, lineWidth: 2, lineOpacity: 0.9,
    fillOpacity: 0.8, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 12, palette: ['#000'],
    ...partial,
  }
}

function rule(partial: Partial<FilterRule> & { field: string }): FilterRule {
  return { id: 'r', operator: 'eq', ...partial }
}

const rows = (): DataRow[] => [
  { group: 'a', value: 10, label: 'Alpha One' },
  { group: 'a', value: 20, label: 'Alpha Two' },
  { group: 'b', value: 30, label: 'Beta One' },
  { group: 'b', value: 40, label: 'Beta Two' },
]

describe('filteredRows', () => {
  it('tags rows with their original index', () => {
    const out = filteredRows(dataset(rows()), spec())
    expect(out.map((row) => row[ROW_ID])).toEqual([0, 1, 2, 3])
  })

  it('requires every rule under and-logic', () => {
    const out = filteredRows(dataset(rows()), spec({
      filterLogic: 'and',
      filters: [rule({ id: '1', field: 'group', value: 'a' }), rule({ id: '2', field: 'value', operator: 'gt', value: '15' })],
    }))
    expect(out.map((row) => row.value)).toEqual([20])
  })

  it('accepts any rule under or-logic', () => {
    const out = filteredRows(dataset(rows()), spec({
      filterLogic: 'or',
      filters: [rule({ id: '1', field: 'group', value: 'a' }), rule({ id: '2', field: 'value', operator: 'gte', value: '40' })],
    }))
    expect(out.map((row) => row.value)).toEqual([10, 20, 40])
  })

  it('compares numerically regardless of bound order', () => {
    const between = (value?: string, value2?: string) => filteredRows(dataset(rows()), spec({
      filters: [rule({ id: '1', field: 'value', operator: 'between', value, value2 })],
    })).map((row) => row.value)
    expect(between('15', '35')).toEqual([20, 30])
    expect(between('35', '15')).toEqual([20, 30])
    expect(filteredRows(dataset(rows()), spec({ filters: [rule({ id: '1', field: 'value', operator: 'lt', value: 'x' })] }))).toHaveLength(0)
  })

  it('matches text case-insensitively and by list', () => {
    const by = (operator: FilterRule['operator'], extra: Partial<FilterRule> = {}) => filteredRows(dataset(rows()), spec({
      filters: [rule({ id: '1', field: 'label', operator, value: 'ALPHA', ...extra })],
    })).map((row) => row.label)
    expect(by('contains')).toEqual(['Alpha One', 'Alpha Two'])
    expect(by('startsWith', { value: 'beta' })).toEqual(['Beta One', 'Beta Two'])
    const listed = filteredRows(dataset(rows()), spec({
      filters: [rule({ id: '1', field: 'label', operator: 'in', values: ['Beta One', 'Alpha Two'] })],
    })).map((row) => row.label)
    expect(listed).toEqual(['Alpha Two', 'Beta One'])
  })

  it('coerces numbers for equality and lets unknown operators pass', () => {
    const eq = filteredRows(dataset(rows()), spec({ filters: [rule({ id: '1', field: 'value', value: '20' })] }))
    expect(eq.map((row) => row.value)).toEqual([20])
    const neq = filteredRows(dataset(rows()), spec({ filters: [rule({ id: '1', field: 'value', operator: 'neq', value: '20' })] }))
    expect(neq).toHaveLength(3)
    const unknown = filteredRows(dataset(rows()), spec({ filters: [rule({ id: '1', field: 'value', operator: 'nope' as FilterRule['operator'] })] }))
    expect(unknown).toHaveLength(4)
  })
})

describe('preparedRows', () => {
  it('returns raw rows when no aggregation applies', () => {
    const data = dataset(rows())
    expect(preparedRows(data, spec({ x: 'group', y: 'value' }))).toHaveLength(4)
  })

  it('summarises each group with mean and count', () => {
    const out = preparedRows(dataset(rows()), spec({ x: 'group', y: 'value', aggregate: 'mean' }))
    expect(out).toHaveLength(2)
    expect(out.find((row) => row.group === 'a')).toMatchObject({ value: 15, __sheetbaseCount: 2 })
    const median = preparedRows(dataset(rows()), spec({ x: 'group', y: 'value', aggregate: 'median' }))
    expect(median.find((row) => row.group === 'b')).toMatchObject({ value: 35 })
    const count = preparedRows(dataset(rows()), spec({ x: 'group', y: 'value', aggregate: 'count' }))
    expect(count.find((row) => row.group === 'a')).toMatchObject({ value: 2 })
  })

  it('centres calculated error bands on the group mean', () => {
    const out = preparedRows(dataset(rows()), spec({ x: 'group', y: 'value', aggregate: 'mean', errorMode: 'ci95' }))
    const group = out.find((row) => row.group === 'a')
    if (!group) throw new Error('expected group a')
    const low = Number(group[ERROR_LOW])
    const high = Number(group[ERROR_HIGH])
    expect(low).toBeLessThan(15)
    expect(high).toBeGreaterThan(15)
    expect(low + high).toBeCloseTo(30, 10)
  })
})

describe('replicateSummary', () => {
  it('counts groups and replicate ranges', () => {
    expect(replicateSummary(dataset(rows()), spec({ x: 'group' }))).toEqual({ groups: 2, eligibleGroups: 2, minN: 2, maxN: 2 })
    expect(replicateSummary(dataset([]), spec({}))).toEqual({ groups: 0, eligibleGroups: 0, minN: 0, maxN: 0 })
  })
})
