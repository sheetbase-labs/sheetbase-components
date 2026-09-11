import { describe, expect, it } from 'vitest'
import { decimatePoints, describeChart } from './chart'
import type { ChartSpec, DataRow } from './types'

function spec(partial: Partial<ChartSpec> = {}): ChartSpec {
  return {
    kind: 'scatter', aggregate: 'none', showPoints: true, showGrid: true,
    pointSize: 5, pointOpacity: 0.9, lineWidth: 2, lineOpacity: 0.9,
    fillOpacity: 0.8, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 12, palette: ['#000'],
    ...partial,
  }
}

function rows(count: number): DataRow[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, y: index * 2 }))
}

describe('decimatePoints', () => {
  it('returns small inputs untouched', () => {
    const input = rows(100)
    expect(decimatePoints(input, 8000)).toBe(input)
  })

  it('caps large inputs while preserving order and endpoints', () => {
    const out = decimatePoints(rows(20000), 8000)
    expect(out).toHaveLength(8000)
    expect(out[0]).toMatchObject({ x: 0 })
    expect(out[7999]).toMatchObject({ x: 19997 })
    const xs = out.map((row) => Number(row.x))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('is deterministic across calls', () => {
    const input = rows(50000)
    expect(decimatePoints(input, 1000)).toEqual(decimatePoints(input, 1000))
  })
})

describe('describeChart', () => {
  it('names kind, aggregate, and mapped fields', () => {
    expect(describeChart(spec({ kind: 'bar', x: 'assay', y: 'result', aggregate: 'mean' }), 7))
      .toBe('Bar chart of mean of result by assay, 7 rows')
  })

  it('omits the aggregate when it is none and singularises one row', () => {
    expect(describeChart(spec({ kind: 'scatter', x: 'a', y: 'b', aggregate: 'none' }), 1))
      .toBe('Scatter chart of b by a, 1 row')
  })

  it('includes group/color and facet fields', () => {
    expect(describeChart(spec({ kind: 'line', x: 'day', y: 'count', aggregate: 'sum', group: 'site', facet: 'lab' }), 12))
      .toBe('Line chart of sum of count by day, grouped by site, faceted by lab, 12 rows')
  })

  it('falls back to color when group is absent and tolerates a missing y', () => {
    expect(describeChart(spec({ kind: 'histogram', x: 'score', aggregate: 'none', color: 'cohort' }), 40))
      .toBe('Histogram chart of score, grouped by cohort, 40 rows')
  })
})
