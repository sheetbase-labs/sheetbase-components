import { describe, expect, it } from 'vitest'
import { applyView, type AnalysisView, type FilterNode, type GroupNode } from 'sheetbase-shared'
import { filteredRows } from './explore'
import { inferColumns } from './schema'
import { filtersFromTree, treeFromFilters } from './view'
import type { ChartSpec, DataRow, Dataset } from './types'

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

function group(combinator: GroupNode['combinator'], children: FilterNode[]): GroupNode {
  return { type: 'group', id: 'g', combinator, children }
}

function condition(field: string, value: unknown): FilterNode {
  return { type: 'condition', id: `c_${field}`, field, operator: 'eq', value }
}

describe('filtersFromTree', () => {
  it('flattens a single-level AND tree', () => {
    const out = filtersFromTree(group('AND', [condition('status', 'ok'), condition('region', 'eu')]))
    expect(out?.logic).toBe('and')
    expect(out?.rules.map((rule) => [rule.field, rule.value])).toEqual([['status', 'ok'], ['region', 'eu']])
  })

  it('flattens a single-level OR tree', () => {
    const out = filtersFromTree(group('OR', [condition('status', 'ok'), condition('status', 'failed')]))
    expect(out?.logic).toBe('or')
    expect(out?.rules).toHaveLength(2)
  })

  it('refuses a NOT group, even a single-child one', () => {
    expect(filtersFromTree(group('NOT', [condition('status', 'ok')]))).toBeUndefined()
    expect(filtersFromTree(group('NOT', []))).toBeUndefined()
  })

  it('refuses mixed-combinator nesting', () => {
    const tree = group('AND', [group('OR', [condition('a', 1), condition('b', 2)]), condition('c', 3)])
    expect(filtersFromTree(tree)).toBeUndefined()
  })

  it('flattens same-combinator nesting', () => {
    const tree = group('AND', [group('AND', [condition('a', 1), condition('b', 2)]), condition('c', 3)])
    const out = filtersFromTree(tree)
    expect(out?.logic).toBe('and')
    expect(out?.rules.map((rule) => rule.field)).toEqual(['a', 'b', 'c'])
  })

  it('round-trips a flat tree through treeFromFilters', () => {
    const flat = group('OR', [condition('a', 1), condition('b', 2)])
    const out = filtersFromTree(flat)
    if (!out) throw new Error('expected flat rules')
    const back = treeFromFilters(out.rules, out.logic)
    expect(back.combinator).toBe('OR')
    expect(back.children.map((child) => (child as { field: string }).field)).toEqual(['a', 'b'])
  })
})

describe('non-flattenable view data path', () => {
  const rows: DataRow[] = [
    { status: 'ok', region: 'us' },
    { status: 'failed', region: 'eu' },
    { status: 'pending', region: 'apac' },
  ]

  it('applyView plus empty flat rules yields exactly the NOT-complement rows', () => {
    const view: AnalysisView = { filter: group('NOT', [condition('status', 'ok'), condition('region', 'eu')]), summary: 'none' }
    // App.tsx passes no flat rules when filtersFromTree refuses the tree;
    // filteredRows with an empty filter list returns every (already-filtered) row.
    expect(filtersFromTree(view.filter)).toBeUndefined()
    const viewRows = applyView(dataset(rows).rows, view)
    const out = filteredRows({ ...dataset(rows), rows: viewRows }, spec({ filters: [] }))
    expect(out.map((row) => row.status)).toEqual(['pending'])
  })
})
