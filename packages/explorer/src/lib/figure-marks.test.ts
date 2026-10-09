/**
 * COMP-03 extras: the bar, box and heatmap primitives of the static figure
 * model (`figure.ts`) and the standalone `Chart`.
 *
 * Every expected number is derived from the default 844×262 frame — plot
 * 56,20 → 824,220 — so a change to a primitive's geometry fails here first.
 * The design system's `Chart/README.md` supplies the rules: quiet axes, fine
 * gridlines, `series-a/b/c` by series index and no gradients.
 */
import { describe, expect, it } from 'vitest'
import {
  HEATMAP_SCALE_STEPS, bandScale, boxSummary, buildFigure, buildFigureGroup, describeFigure,
  heatmapColour, heatmapStep,
} from './figure'
import type { ChartSpec, Dataset } from './types'

function spec(partial: Partial<ChartSpec>): ChartSpec {
  return {
    kind: 'bar', aggregate: 'none', showGrid: true, showPoints: true,
    pointSize: 4, pointOpacity: 1, lineWidth: 1.6, lineOpacity: 1,
    fillOpacity: 1, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 12, palette: [],
    ...partial,
  }
}

/** Two panels over three assays: one value per (assay, panel) cell. */
const plateRows = [
  { Assay: 'CBC', Panel: 'Day 1', Value: 12 },
  { Assay: 'CBC', Panel: 'Day 2', Value: 18 },
  { Assay: 'Chem', Panel: 'Day 1', Value: 8 },
  { Assay: 'Chem', Panel: 'Day 2', Value: 20 },
  { Assay: 'Micro', Panel: 'Day 1', Value: 5 },
  { Assay: 'Micro', Panel: 'Day 2', Value: 9 },
]

const plate: Dataset = {
  name: 'Plate',
  source: 'fixture',
  rows: plateRows,
  columns: [
    { key: 'Assay', kind: 'string', nullable: false, uniqueCount: 3 },
    { key: 'Panel', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Value', kind: 'number', nullable: false, uniqueCount: 6 },
  ],
}

/** Three replicates per train, plus one high outlier in Train A. */
const boxRows = [
  { Train: 'A', Yield: 10 }, { Train: 'A', Yield: 12 }, { Train: 'A', Yield: 14 },
  { Train: 'A', Yield: 16 }, { Train: 'A', Yield: 40 },
  { Train: 'B', Yield: 20 }, { Train: 'B', Yield: 22 }, { Train: 'B', Yield: 24 }, { Train: 'B', Yield: 26 },
]

const boxDataset: Dataset = {
  name: 'Box fixture',
  source: 'fixture',
  rows: boxRows,
  columns: [
    { key: 'Train', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Yield', kind: 'number', nullable: false, uniqueCount: 8 },
  ],
}

const heatRows = [
  { Assay: 'CBC', Panel: 'Day 1', Value: 1 },
  { Assay: 'CBC', Panel: 'Day 2', Value: 2 },
  { Assay: 'Chem', Panel: 'Day 1', Value: 3 },
  { Assay: 'Chem', Panel: 'Day 2', Value: 4 },
]

const heatDataset: Dataset = {
  name: 'Heat fixture',
  source: 'fixture',
  rows: heatRows,
  columns: [
    { key: 'Assay', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Panel', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Value', kind: 'number', nullable: false, uniqueCount: 4 },
  ],
}

const bar = (partial: Partial<ChartSpec> = {}) => spec({
  x: 'Assay', y: 'Value', group: 'Panel', xLabel: 'Assay', yLabel: 'Value',
  ...partial,
})

describe('bandScale', () => {
  it('spreads categories across the plot with the design padding', () => {
    const band = bandScale(3, [56, 824])
    expect(band.step).toBe(256)
    expect(band.width).toBeCloseTo(209.92, 6)
    expect(band.start(0)).toBeCloseTo(79.04, 6)
    expect(band.start(2)).toBeCloseTo(591.04, 6)
    expect(band.centre(0)).toBeCloseTo(184, 6)
    expect(band.centre(2)).toBeCloseTo(696, 6)
  })
})

describe('bar figure (grouped)', () => {
  const figure = buildFigure(plate, bar())
  if (!figure) throw new Error('the grouped bar figure should build')

  it('puts one tick per category on the band axis', () => {
    expect(figure.x.kind).toBe('band')
    expect(figure.x.domain).toEqual([0, 3])
    expect(figure.x.ticks.map((tick) => tick.label)).toEqual(['CBC', 'Chem', 'Micro'])
    expect(figure.x.ticks.map((tick) => tick.px)).toEqual([184, 440, 696])
    const cbc = figure.x.bands?.[0]
    expect(cbc?.value).toBe('CBC')
    expect(cbc?.label).toBe('CBC')
    expect(cbc?.start).toBeCloseTo(79.04, 6)
    expect(cbc?.width).toBeCloseTo(209.92, 6)
    expect(cbc?.px).toBeCloseTo(184, 6)
    expect(figure.series).toEqual([])
    expect(figure.legend.map((item) => item.label)).toEqual(['Day 1', 'Day 2'])
    expect(figure.legend.map((item) => item.style.colour)).toEqual(['var(--series-a)', 'var(--series-b)'])
  })

  it('anchors the y domain at zero and groups sibling series side by side', () => {
    expect(figure.y.domain).toEqual([0, 20])
    expect(figure.gridlines.map((py) => Number(py.toFixed(1)))).toEqual([170, 120, 70, 20])
    const [cbcDay1, , , cbcDay2] = figure.bars ?? []
    expect(cbcDay1).toMatchObject({ category: 'CBC', seriesId: 'Day 1', value: 12, value0: 0, colour: 'var(--series-a)' })
    expect(cbcDay1?.x).toBeCloseTo(79.04, 6)
    expect(cbcDay1?.width).toBeCloseTo(103.96, 6)
    expect(cbcDay1?.y).toBeCloseTo(100, 6)
    expect(cbcDay1?.height).toBeCloseTo(120, 6)
    expect(cbcDay2).toMatchObject({ category: 'CBC', seriesId: 'Day 2', value: 18, colour: 'var(--series-b)' })
    expect(cbcDay2?.x).toBeCloseTo(185, 6)
    expect(cbcDay2?.y).toBeCloseTo(40, 6)
    expect(cbcDay2?.height).toBeCloseTo(180, 6)
  })

  it('labels each bar when the spec asks', () => {
    const labelled = buildFigure(plate, bar({ labels: true }))
    const first = labelled?.bars?.[0]
    expect(first?.label).toBe('12')
    expect(first?.labelX).toBeCloseTo(131.02, 6)
    expect(first?.labelY).toBeCloseTo(96, 6)
  })
})

describe('bar figure (stacked and normalised)', () => {
  it('stacks segments on the accumulated baseline', () => {
    const figure = buildFigure(plate, bar({ barLayout: 'stacked' }))
    if (!figure) throw new Error('the stacked bar figure should build')
    // Category totals drive the domain: CBC 30, Chem 28, Micro 14.
    expect(figure.y.domain).toEqual([0, 30])
    const [cbcDay1, , , cbcDay2] = figure.bars ?? []
    expect(cbcDay1).toMatchObject({ value: 12, value0: 0 })
    expect(cbcDay1?.x).toBeCloseTo(79.04, 6)
    expect(cbcDay1?.width).toBeCloseTo(209.92, 6)
    expect(cbcDay1?.y).toBeCloseTo(140, 6)
    expect(cbcDay1?.height).toBeCloseTo(80, 6)
    expect(cbcDay2).toMatchObject({ value: 18, value0: 12 })
    expect(cbcDay2?.y).toBeCloseTo(20, 6)
    expect(cbcDay2?.height).toBeCloseTo(120, 6)
  })

  it('normalises each category to a full band on a 0–1 domain', () => {
    const figure = buildFigure(plate, bar({ barLayout: 'normalized' }))
    if (!figure) throw new Error('the normalised bar figure should build')
    expect(figure.y.domain).toEqual([0, 1])
    const [cbcDay1, , , cbcDay2] = figure.bars ?? []
    expect(cbcDay1?.value).toBeCloseTo(12 / 30, 6)
    expect(cbcDay1?.y).toBeCloseTo(140, 6)
    expect(cbcDay1?.height).toBeCloseTo(80, 6)
    expect(cbcDay2?.value).toBeCloseTo(18 / 30, 6)
    expect(cbcDay2?.value0).toBeCloseTo(12 / 30, 6)
    expect(cbcDay2?.y).toBeCloseTo(20, 6)
    expect(cbcDay2?.height).toBeCloseTo(120, 6)
  })

  it('orders categories by value or label when asked', () => {
    const byValue = buildFigure(plate, bar({ categoryOrder: 'value-desc' }))
    // CBC 30 > Chem 28 > Micro 14.
    expect(byValue?.x.ticks.map((tick) => tick.label)).toEqual(['CBC', 'Chem', 'Micro'])
    const byLabel = buildFigure(plate, bar({ categoryOrder: 'label-asc' }))
    expect(byLabel?.x.ticks.map((tick) => tick.label)).toEqual(['CBC', 'Chem', 'Micro'])
    const ascending = buildFigure(plate, bar({ categoryOrder: 'value-asc' }))
    expect(ascending?.x.ticks.map((tick) => tick.label)).toEqual(['Micro', 'Chem', 'CBC'])
  })
})

describe('boxSummary', () => {
  it('interpolates quartiles and applies the 1.5×IQR fence', () => {
    expect(boxSummary([10, 12, 14, 16, 40])).toEqual({
      min: 10, q1: 12, median: 14, q3: 16, max: 40, whiskerLow: 10, whiskerHigh: 16,
    })
    expect(boxSummary([1, 2, 3, 4])).toEqual({
      min: 1, q1: 1.75, median: 2.5, q3: 3.25, max: 4, whiskerLow: 1, whiskerHigh: 4,
    })
    expect(Number.isNaN(boxSummary([]).median)).toBe(true)
  })
})

describe('box figure', () => {
  const figure = buildFigure(boxDataset, spec({
    kind: 'box', x: 'Train', y: 'Yield', xLabel: 'Train', yLabel: 'Yield', yUnit: '%',
  }))
  if (!figure) throw new Error('the box figure should build')

  it('draws one five-number summary per category', () => {
    expect(figure.boxes).toHaveLength(2)
    expect(figure.x.ticks.map((tick) => tick.label)).toEqual(['A', 'B'])
    const [trainA, trainB] = figure.boxes ?? []
    expect(trainA).toMatchObject({ category: 'A', q1: 12, median: 14, q3: 16, min: 10, max: 40, whiskerLow: 10, whiskerHigh: 16, colour: 'var(--series-a)' })
    expect(trainA?.x).toBeCloseTo(90.56, 6)
    expect(trainA?.width).toBeCloseTo(314.88, 6)
    expect(trainA?.px).toBeCloseTo(248, 6)
    expect(trainB).toMatchObject({ category: 'B', q1: 21.5, median: 23, q3: 24.5, min: 20, max: 26, whiskerLow: 20, whiskerHigh: 26 })
    expect(trainB?.outliers).toEqual([])
  })

  it('maps the summary onto the widened y domain', () => {
    expect(figure.y.domain).toEqual([10, 40])
    const trainA = figure.boxes?.[0]
    expect(trainA?.yMin).toBeCloseTo(220, 6)
    expect(trainA?.yQ1).toBeCloseTo(206.667, 3)
    expect(trainA?.yMedian).toBeCloseTo(193.333, 3)
    expect(trainA?.yQ3).toBeCloseTo(180, 6)
    expect(trainA?.yWhiskerHigh).toBeCloseTo(180, 6)
  })

  it('keeps the point beyond the whisker as an outlier, drawn only on request', () => {
    const trainA = figure.boxes?.[0]
    expect(trainA?.outliers).toHaveLength(1)
    expect(trainA?.outliers[0]?.value).toBe(40)
    expect(trainA?.outliers[0]?.py).toBeCloseTo(20, 6)
    expect(trainA?.showOutliers).toBe(true)
    const quiet = buildFigure(boxDataset, spec({
      kind: 'box', x: 'Train', y: 'Yield', showPoints: false,
    }))
    expect(quiet?.boxes?.[0]?.outliers).toHaveLength(1)
    expect(quiet?.boxes?.[0]?.showOutliers).toBe(false)
  })

  it('groups boxes side by side when a series field is set', () => {
    const groupedRows = [
      { Train: 'A', Lot: 'L1', Yield: 10 }, { Train: 'A', Lot: 'L1', Yield: 14 },
      { Train: 'A', Lot: 'L2', Yield: 12 }, { Train: 'A', Lot: 'L2', Yield: 16 },
      { Train: 'B', Lot: 'L1', Yield: 20 }, { Train: 'B', Lot: 'L1', Yield: 24 },
      { Train: 'B', Lot: 'L2', Yield: 22 }, { Train: 'B', Lot: 'L2', Yield: 26 },
    ]
    const grouped = buildFigure(
      {
        name: 'Grouped box fixture',
        source: 'fixture',
        rows: groupedRows,
        columns: [
          { key: 'Train', kind: 'string', nullable: false, uniqueCount: 2 },
          { key: 'Lot', kind: 'string', nullable: false, uniqueCount: 2 },
          { key: 'Yield', kind: 'number', nullable: false, uniqueCount: 8 },
        ],
      },
      spec({ kind: 'box', x: 'Train', y: 'Yield', group: 'Lot' }),
    )
    expect(grouped?.boxes).toHaveLength(4)
    expect(grouped?.legend.map((item) => item.label)).toEqual(['L1', 'L2'])
    const boxAt = (category: string, seriesId: string) => grouped?.boxes?.find((box) => box.category === category && box.seriesId === seriesId)
    expect(boxAt('A', 'L1')?.colour).toBe('var(--series-a)')
    expect(boxAt('A', 'L2')?.colour).toBe('var(--series-b)')
    expect(boxAt('A', 'L1')?.x).toBeLessThan(boxAt('A', 'L2')?.x ?? 0)
    expect(boxAt('B', 'L1')?.x).toBeLessThan(boxAt('B', 'L2')?.x ?? 0)
  })
})

describe('heatmap figure', () => {
  const figure = buildFigure(heatDataset, spec({
    kind: 'heatmap', x: 'Assay', y: 'Panel', size: 'Value', aggregate: 'mean',
    xLabel: 'Assay', yLabel: 'Panel',
  }))
  if (!figure) throw new Error('the heatmap figure should build')

  it('lays the value grid over two band axes', () => {
    expect(figure.x.kind).toBe('band')
    expect(figure.y.kind).toBe('band')
    expect(figure.x.ticks.map((tick) => [tick.label, tick.px, tick.py]))
      .toEqual([['CBC', 248, 242], ['Chem', 632, 242]])
    expect(figure.y.ticks.map((tick) => [tick.label, tick.px, tick.py]))
      .toEqual([['Day 1', 48, 70], ['Day 2', 48, 170]])
    expect(figure.heat).toHaveLength(4)
    expect(figure.heat?.[0]).toMatchObject({ x: 'CBC', y: 'Day 1', value: 1 })
    const first = figure.heat?.[0]?.rect
    expect(first?.x).toBeCloseTo(65.6, 6)
    expect(first?.y).toBeCloseTo(22.5, 6)
    expect(first?.width).toBeCloseTo(364.8, 6)
    expect(first?.height).toBeCloseTo(95, 6)
  })

  it('colours each cell from the themed discrete scale', () => {
    const colour = (x: string, y: string) => figure.heat?.find((cell) => cell.x === x && cell.y === y)?.colour
    expect(colour('CBC', 'Day 1')).toBe('color-mix(in srgb, var(--series-a) 20%, var(--surface))')
    expect(colour('CBC', 'Day 2')).toBe('color-mix(in srgb, var(--series-a) 40%, var(--surface))')
    expect(colour('Chem', 'Day 1')).toBe('color-mix(in srgb, var(--series-a) 80%, var(--surface))')
    expect(colour('Chem', 'Day 2')).toBe('color-mix(in srgb, var(--series-a) 100%, var(--surface))')
  })

  it('legends the scale from the data range', () => {
    expect(figure.scaleLegend?.label).toBe('Value')
    expect(figure.scaleLegend?.min).toBe(1)
    expect(figure.scaleLegend?.max).toBe(4)
    expect(figure.scaleLegend?.steps).toHaveLength(HEATMAP_SCALE_STEPS)
    expect(figure.scaleLegend?.steps[0]).toMatchObject({ from: 1, to: 1.375 })
    expect(figure.scaleLegend?.steps[4]).toMatchObject({ colour: 'color-mix(in srgb, var(--series-a) 100%, var(--surface))', to: 4 })
  })

  it('counts rows per cell when no size field is given', () => {
    const counted = buildFigure(
      { ...heatDataset, rows: [...heatRows, { Assay: 'CBC', Panel: 'Day 1', Value: 99 }] },
      spec({ kind: 'heatmap', x: 'Assay', y: 'Panel' }),
    )
    expect(counted?.scaleLegend?.label).toBe('count')
    const cell = counted?.heat?.find((entry) => entry.x === 'CBC' && entry.y === 'Day 1')
    expect(cell?.value).toBe(2)
    expect(counted?.heat).toHaveLength(4)
  })
})

describe('heatmap scale', () => {
  it('buckets a normalised value onto five discrete steps', () => {
    expect(heatmapStep(0)).toBe(0)
    expect(heatmapStep(0.1)).toBe(0)
    expect(heatmapStep(1 / 3)).toBe(1)
    expect(heatmapStep(2 / 3)).toBe(3)
    expect(heatmapStep(0.95)).toBe(4)
    expect(heatmapStep(Number.NaN)).toBe(0)
  })

  it('never emits a literal colour', () => {
    for (let step = 0; step < HEATMAP_SCALE_STEPS; step++) {
      const colour = heatmapColour(step / (HEATMAP_SCALE_STEPS - 1))
      expect(colour).toMatch(/^color-mix\(in srgb, var\(--series-a\) \d+%, var\(--surface\)\)$/)
      expect(colour).not.toMatch(/#[0-9a-fA-F]{3}/)
    }
  })
})

describe('figure descriptions and stacks for the new kinds', () => {
  it('names each kind and its mapping', () => {
    expect(describeFigure(bar(), 6, ['Day 1', 'Day 2']))
      .toBe('Bar chart of Value against Assay, for Day 1, Day 2, 6 rows')
    expect(describeFigure(spec({ kind: 'box', x: 'Train', y: 'Yield', yLabel: 'Yield', yUnit: '%' }), 9, []))
      .toBe('Box plot of Yield (%) against Train, 9 rows')
    expect(describeFigure(spec({ kind: 'heatmap', x: 'Assay', y: 'Panel', size: 'Value' }), 4, []))
      .toBe('Heatmap of Value by Assay and Panel, 4 rows')
  })

  it('refuses to share a numeric x axis with a categorical kind', () => {
    expect(buildFigureGroup(plate, [{ spec: bar() }, { spec: bar() }])).toBeNull()
  })
})
