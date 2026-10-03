/**
 * COMP-07 distributions: the histogram (bin primitive) and violin (density
 * primitive) of the static figure model (`figure.ts`) and the standalone
 * `Chart`.
 *
 * Every expected number is derived from the default 844×262 frame — plot
 * 56,20 → 824,220 — so a change to a primitive's geometry fails here first.
 */
import { describe, expect, it } from 'vitest'
import { binEdges, buildFigure, buildFigureGroup, describeFigure, kde, kdeBandwidth } from './figure'
import type { ChartSpec, Dataset } from './types'

function spec(partial: Partial<ChartSpec>): ChartSpec {
  return {
    kind: 'histogram', aggregate: 'none', showGrid: true, showPoints: true,
    pointSize: 4, pointOpacity: 1, lineWidth: 1.6, lineOpacity: 1,
    fillOpacity: 1, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 12, palette: [],
    ...partial,
  }
}

const histRows = [
  { Score: 2, Cohort: 'A' }, { Score: 3, Cohort: 'A' }, { Score: 7, Cohort: 'A' },
  { Score: 12, Cohort: 'B' }, { Score: 18, Cohort: 'B' }, { Score: 19, Cohort: 'B' },
]

const histDataset: Dataset = {
  name: 'Histogram fixture',
  source: 'fixture',
  rows: histRows,
  columns: [
    { key: 'Score', kind: 'number', nullable: false, uniqueCount: 6 },
    { key: 'Cohort', kind: 'string', nullable: false, uniqueCount: 2 },
  ],
}

/** Four replicates per train, at the same spacing, for a symmetric KDE. */
const violinRows = [
  { Train: 'A', Yield: 10 }, { Train: 'A', Yield: 12 }, { Train: 'A', Yield: 14 }, { Train: 'A', Yield: 16 },
  { Train: 'B', Yield: 20 }, { Train: 'B', Yield: 22 }, { Train: 'B', Yield: 24 }, { Train: 'B', Yield: 26 },
]

const violinDataset: Dataset = {
  name: 'Violin fixture',
  source: 'fixture',
  rows: violinRows,
  columns: [
    { key: 'Train', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Yield', kind: 'number', nullable: false, uniqueCount: 8 },
  ],
}

const histogram = (partial: Partial<ChartSpec> = {}) =>
  spec({ kind: 'histogram', x: 'Score', xLabel: 'Score', yLabel: 'Count', histogramBins: 2, ...partial })

describe('binEdges', () => {
  it('divides the observed range into the requested number of bins', () => {
    expect(binEdges([2, 3, 7, 12, 18, 19], { bins: 2 })).toEqual([2, 10.5, 19])
  })

  it('lets an explicit width win and stretch the final bin', () => {
    expect(binEdges([1, 99], { width: 5 })).toEqual([1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96, 101])
  })

  it('falls back to Sturges\u2019 rule and honours a fixed range', () => {
    expect(binEdges([1, 2, 3, 4, 5, 6, 7, 8], {})).toEqual([1, 2.75, 4.5, 6.25, 8])
    expect(binEdges([5], { min: 0, max: 10, bins: 2 })).toEqual([0, 5, 10])
    expect(binEdges([])).toEqual([])
    expect(binEdges([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([])
  })
})

describe('kde', () => {
  it('samples the density symmetrically over a padded range', () => {
    expect(kdeBandwidth([10, 12, 14, 16])).toBeCloseTo(2.074188573615128, 12)
    expect(kde([10, 12, 14, 16], { samples: 4 })).toEqual([
      { value: 9.52, density: 0.07537285754491367 },
      { value: 11.84, density: 0.11477776211027588 },
      { value: 14.16, density: 0.11477776211027588 },
      { value: 16.48, density: 0.07537285754491367 },
    ])
  })

  it('keeps a positive bandwidth for a constant sample', () => {
    const samples = kde([5, 5, 5], { samples: 3 })
    expect(samples.map((sample) => sample.value)).toEqual([4.6, 5, 5.4])
    expect(samples[1]?.density).toBeCloseTo(0.7978845608028655, 12)
    expect(kde([])).toEqual([])
  })
})

describe('histogram figure', () => {
  const figure = buildFigure(histDataset, histogram())
  if (!figure) throw new Error('the histogram figure should build')

  it('bins the measure onto a numeric x axis and counts per bin', () => {
    expect(figure.x.kind).toBeUndefined()
    expect(figure.x.domain).toEqual([2, 19])
    expect(figure.x.ticks.map((tick) => [tick.label, Number(tick.px.toFixed(1))]))
      .toEqual([['5', 191.5], ['10', 417.4], ['15', 643.3]])
    expect(figure.bins).toEqual([
      { index: 0, x0: 2, x1: 10.5, value: 6.25, label: '2\u201310.5' },
      { index: 1, x0: 10.5, x1: 19, value: 14.75, label: '10.5\u201319' },
    ])
    expect(figure.bars).toHaveLength(2)
    const [first, second] = figure.bars ?? []
    expect(first).toMatchObject({ category: '2\u201310.5', seriesId: '', colour: 'var(--series-a)', value: 3, value0: 0, x: 57, y: 20, width: 382, height: 200 })
    expect(second).toMatchObject({ category: '10.5\u201319', value: 3, x: 441, y: 20, width: 382, height: 200 })
  })

  it('labels the count axis and clears the origin gridline', () => {
    expect(figure.y.domain).toEqual([0, 3])
    expect(figure.y.title).toBe('Count')
    expect(figure.y.ticks.map((tick) => tick.label)).toEqual(['0', '1', '2', '3'])
    expect(figure.gridlines.map((py) => Number(py.toFixed(4)))).toEqual([153.3333, 86.6667, 20])
  })

  it('plots a probability density when asked', () => {
    const figureDensity = buildFigure(histDataset, histogram({ histogramDensity: true, yLabel: undefined }))
    expect(figureDensity?.y.title).toBe('Density')
    expect(figureDensity?.y.domain).toEqual([0, 0.06])
    expect(figureDensity?.bars?.map((bar) => Number(bar.value.toFixed(6)))).toEqual([0.058824, 0.058824])
  })

  it('accepts an explicit bin width', () => {
    const figureWidth = buildFigure(histDataset, histogram({ histogramBinWidth: 5 }))
    expect(figureWidth?.x.domain).toEqual([2, 22])
    expect(figureWidth?.bins?.map((bin) => [bin.x0, bin.x1])).toEqual([[2, 7], [7, 12], [12, 17], [17, 22]])
  })

  it('groups sibling series side by side and stacks them on request', () => {
    const grouped = buildFigure(histDataset, histogram({ color: 'Cohort' }))
    expect(grouped?.legend.map((item) => item.label)).toEqual(['A', 'B'])
    expect(grouped?.bars?.map((bar) => [bar.seriesId, bar.category, bar.x, bar.width, bar.value]))
      .toEqual([['A', '2\u201310.5', 57, 190, 3], ['B', '10.5\u201319', 633, 190, 3]])

    const stacked = buildFigure(histDataset, histogram({ color: 'Cohort', barLayout: 'stacked' }))
    expect(stacked?.bars?.map((bar) => bar.width)).toEqual([382, 382])
  })

  it('describes the histogram', () => {
    expect(describeFigure(histogram(), 6, [])).toBe('Histogram of Score, 6 rows')
  })
})

describe('violin figure', () => {
  const figure = buildFigure(violinDataset, spec({ kind: 'violin', x: 'Train', y: 'Yield', xLabel: 'Train', yLabel: 'Yield' }))
  if (!figure) throw new Error('the violin figure should build')

  it('puts one violin per category on a band axis over the shared y domain', () => {
    expect(figure.x.kind).toBe('band')
    expect(figure.x.ticks.map((tick) => [tick.label, tick.px])).toEqual([['A', 248], ['B', 632]])
    expect(figure.y.domain).toEqual([10, 30])
    expect(figure.gridlines.map((py) => Number(py.toFixed(4)))).toEqual([170, 120, 70, 20])
    expect(figure.violins).toHaveLength(2)
  })

  it('draws a closed density profile with the design box overlay', () => {
    const [trainA, trainB] = figure.violins ?? []
    expect(trainA).toMatchObject({ category: 'A', seriesId: '', colour: 'var(--series-a)', x: 90.56, width: 314.88, px: 248 })
    expect(trainA?.density).toHaveLength(32)
    expect(trainA?.outline).toHaveLength(64)
    expect(trainA?.outline[0]?.px).toBeCloseTo(148.5836, 3)
    expect(trainA?.outline[0]?.py).toBe(220)
    expect(trainA?.outline[63]?.px).toBeCloseTo(347.4164, 3)
    expect(trainA?.box).toEqual({
      min: 10, q1: 11.5, median: 13, q3: 14.5, max: 16,
      whiskerLow: 10, whiskerHigh: 16,
      yWhiskerLow: 220, yQ1: 205, yMedian: 190, yQ3: 175, yWhiskerHigh: 160,
    })
    expect(trainB?.box.median).toBe(23)
  })

  it('is y-only when no category field is set', () => {
    const yOnly = buildFigure(violinDataset, spec({ kind: 'violin', y: 'Yield', yLabel: 'Yield' }))
    expect(yOnly?.violins?.map((violin) => violin.category)).toEqual(['all'])
    expect(yOnly?.xTitle).toBe('')
    expect(describeFigure(spec({ kind: 'violin', y: 'Yield', yLabel: 'Yield' }), 8, [])).toBe('Violin plot of Yield, 8 rows')
  })

  it('groups sibling series side by side within a category', () => {
    const groupedRows = [
      ...violinRows.map((row) => ({ ...row, Lot: 'L1' })),
      ...violinRows.map((row) => ({ ...row, Lot: 'L2', Yield: row.Yield + 1 })),
    ]
    const groupedDataset: Dataset = { name: 'Grouped violin fixture', source: 'fixture', rows: groupedRows, columns: violinDataset.columns }
    const grouped = buildFigure(groupedDataset, spec({ kind: 'violin', x: 'Train', y: 'Yield', group: 'Lot' }))
    expect(grouped?.legend.map((item) => item.label)).toEqual(['L1', 'L2'])
    expect(grouped?.violins?.map((violin) => [violin.category, violin.seriesId, violin.x, violin.width, violin.colour]))
      .toEqual([
        ['A', 'L1', 90.56, 155.74, 'var(--series-a)'],
        ['B', 'L1', 474.56, 155.74, 'var(--series-a)'],
        ['A', 'L2', 249.70000000000002, 155.74, 'var(--series-b)'],
        ['B', 'L2', 633.7, 155.74, 'var(--series-b)'],
      ])
  })

  it('describes the grouped violin', () => {
    expect(describeFigure(spec({ kind: 'violin', x: 'Train', y: 'Yield', xLabel: 'Train', yLabel: 'Yield' }), 8, []))
      .toBe('Violin plot of Yield against Train, 8 rows')
  })
})

describe('distribution stacks', () => {
  it('refuses to share a numeric x axis with a distribution kind', () => {
    expect(buildFigureGroup(histDataset, [{ spec: histogram() }])).toBeNull()
    expect(buildFigureGroup(violinDataset, [{ spec: spec({ kind: 'violin', x: 'Train', y: 'Yield' }) }])).toBeNull()
  })
})
