/**
 * COMP-03 fixture tests: the Analysis screen's step-yield and turbidity charts
 * (`canvas/Analysis.dc.html`, mirrored in `Notebook.dc.html` Figure 1) rendered
 * from the same nine-condition fixture. Every expected number below is the
 * design's own geometry, so a change to the figure rules fails here first.
 *
 * The design canvas draws its charts by hand:
 *   step yield  — plot 56,20 → 824,220; x domain 25–175; y domain 60–95
 *   turbidity   — plot 56,20 → 824,160; x domain 25–175; y domain 0–30
 * so `x` values 50/100/150 land on 184/440/696 in both charts (a shared axis),
 * and the y pixels asserted here are the design's own point coordinates.
 */
import { describe, expect, it } from 'vitest'
import {
  axisTitle, buildFigure, buildFigureGroup, clipPolyline, describeFigure, formatValue,
  niceStep, niceTicks, referenceText, seriesStyle,
} from './figure'
import { rolesFromSpec, specWithRole, chartFieldsFromDataset, fieldHint, roleOf, type ChartField } from './roles'
import type { ChartSpec, Dataset } from './types'

/** The Analysis screen's nine conditions: three trains × three filter loads. */
const rows = [
  { Condition: 'A-50', Train: 'Train A', Load: 50, Turbidity: 6.2, StepYield: 86.0, Flagged: false },
  { Condition: 'A-100', Train: 'Train A', Load: 100, Turbidity: 9.8, StepYield: 82.6, Flagged: false },
  { Condition: 'A-150', Train: 'Train A', Load: 150, Turbidity: 18.4, StepYield: 75.6, Flagged: false },
  { Condition: 'B-50', Train: 'Train B', Load: 50, Turbidity: 4.1, StepYield: 90.7, Flagged: false },
  { Condition: 'B-100', Train: 'Train B', Load: 100, Turbidity: 5.6, StepYield: 88.4, Flagged: false },
  { Condition: 'B-150', Train: 'Train B', Load: 150, Turbidity: 8.9, StepYield: 84.9, Flagged: false },
  { Condition: 'C-50', Train: 'Train C', Load: 50, Turbidity: 12.7, StepYield: 80.2, Flagged: false },
  { Condition: 'C-100', Train: 'Train C', Load: 100, Turbidity: 24.3, StepYield: 72.1, Flagged: false },
  { Condition: 'C-150', Train: 'Train C', Load: 150, Turbidity: 61.5, StepYield: 62.8, Flagged: true },
]

const dataset: Dataset = {
  name: 'Clarification runs · EXP-0142',
  source: 'fixture',
  rows,
  columns: [
    { key: 'Condition', kind: 'string', nullable: false, uniqueCount: 9 },
    { key: 'Train', kind: 'string', nullable: false, uniqueCount: 3 },
    { key: 'Load', kind: 'number', nullable: false, uniqueCount: 3 },
    { key: 'Turbidity', kind: 'number', nullable: false, uniqueCount: 9 },
    { key: 'StepYield', kind: 'number', nullable: false, uniqueCount: 9 },
    { key: 'Flagged', kind: 'boolean', nullable: false, uniqueCount: 2 },
  ],
}

function spec(partial: Partial<ChartSpec>): ChartSpec {
  return {
    kind: 'line', aggregate: 'none', showGrid: true, showPoints: true,
    pointSize: 4, pointOpacity: 1, lineWidth: 1.6, lineOpacity: 1,
    fillOpacity: 1, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 12, palette: [],
    ...partial,
  }
}

const stepYield = spec({
  x: 'Load', y: 'StepYield', group: 'Train',
  xMin: 25, xMax: 175, yMin: 60, yMax: 95,
  xLabel: 'Load', xUnit: 'L/m²', yLabel: 'Step yield', yUnit: '%',
  refLines: [{ id: 'target', axis: 'y', value: 80, label: 'Target ≥', unit: '%' }],
  excludeField: 'Flagged', excludedLabel: 'flagged',
})

const turbidity = spec({
  x: 'Load', y: 'Turbidity', group: 'Train',
  xMin: 25, xMax: 175, yMin: 0, yMax: 30,
  xLabel: 'Load', xUnit: 'L/m²', yLabel: 'Turbidity out', yUnit: 'NTU',
  refLines: [{ id: 'limit', axis: 'y', value: 20, label: 'Limit ≤', unit: 'NTU' }],
  excludeField: 'Flagged',
})

/** The Analysis stack's second chart is 196 units tall with a 36-unit gutter. */
const turbidityOptions = { height: 196, padding: { top: 20, right: 20, bottom: 36, left: 56 }, showYAxisTitle: false }

describe('seriesStyle', () => {
  it('cycles circle/square/triangle with series-a/b/c by index', () => {
    expect(seriesStyle(0)).toEqual({ marker: 'circle', colour: 'var(--series-a)' })
    expect(seriesStyle(1)).toEqual({ marker: 'square', colour: 'var(--series-b)' })
    expect(seriesStyle(2)).toEqual({ marker: 'triangle', colour: 'var(--series-c)' })
    expect(seriesStyle(3)).toEqual({ marker: 'circle', colour: 'var(--series-a)' })
  })
})

describe('ticks', () => {
  it('picks the design steps for the step-yield, turbidity and load domains', () => {
    expect(niceStep(35)).toBe(10)
    expect(niceStep(30)).toBe(10)
    expect(niceStep(150)).toBe(50)
    expect(niceTicks([60, 95])).toEqual([60, 70, 80, 90])
    expect(niceTicks([0, 30])).toEqual([0, 10, 20, 30])
    expect(niceTicks([25, 175])).toEqual([50, 100, 150])
  })
})

describe('step yield figure (Analysis chart 1 / Notebook Figure 1)', () => {
  const figure = buildFigure(dataset, stepYield)
  if (!figure) throw new Error('step-yield figure should build')

  it('uses the design plot rectangle', () => {
    expect(figure.width).toBe(844)
    expect(figure.height).toBe(262)
    expect(figure.plot).toEqual({ x: 56, y: 20, width: 768, height: 200 })
  })

  it('maps the shared load axis to the design pixels', () => {
    expect(figure.x.domain).toEqual([25, 175])
    const load = (value: number) => figure.x.ticks.find((tick) => tick.value === value)?.px
    expect(load(50)).toBeCloseTo(184, 6)
    expect(load(100)).toBeCloseTo(440, 6)
    expect(load(150)).toBeCloseTo(696, 6)
    expect(figure.x.ticks.map((tick) => tick.label)).toEqual(['50', '100', '150'])
  })

  it('maps the yield axis to the design pixels and gridlines', () => {
    expect(figure.y.domain).toEqual([60, 95])
    expect(figure.y.ticks.map((tick) => tick.label)).toEqual(['60', '70', '80', '90'])
    const at = (value: number) => figure.y.ticks.find((tick) => tick.value === value)?.py ?? 0
    expect(at(60)).toBeCloseTo(220, 6)
    expect(at(70)).toBeCloseTo(162.857, 3)
    expect(at(80)).toBeCloseTo(105.714, 3)
    expect(at(90)).toBeCloseTo(48.571, 3)
    // The origin tick rides the axis line; 70/80/90 get fine gridlines.
    expect(figure.gridlines).toHaveLength(3)
  })

  it('draws three series with the design markers and coordinates', () => {
    expect(figure.series.map((entry) => entry.label)).toEqual(['Train A', 'Train B', 'Train C'])
    expect(figure.series.map((entry) => entry.style.marker)).toEqual(['circle', 'square', 'triangle'])
    expect(figure.series.map((entry) => entry.style.colour))
      .toEqual(['var(--series-a)', 'var(--series-b)', 'var(--series-c)'])

    const points = (index: number) => figure.series[index]?.points.map((point) => [Number(point.px.toFixed(1)), Number((point.py ?? 0).toFixed(1))])
    expect(points(0)).toEqual([[184, 71.4], [440, 90.9], [696, 130.9]])
    expect(points(1)).toEqual([[184, 44.6], [440, 57.7], [696, 77.7]])
    expect(points(2)).toEqual([[184, 104.6], [440, 150.9], [696, 204]])

    const values = (index: number) => figure.series[index]?.points.map((point) => point.valueY)
    expect(values(0)).toEqual([86, 82.6, 75.6])
    expect(values(2)).toEqual([80.2, 72.1, 62.8])
  })

  it('marks the excluded C-150 point hollow with its label', () => {
    const excluded = figure.series[2]?.points[2]
    expect(excluded?.excluded).toBe(true)
    expect(excluded?.offScale).toBeUndefined()
    expect(excluded?.label).toBe('flagged')
    expect(excluded?.labelX).toBeCloseTo(706, 6)
    expect(excluded?.labelY).toBeCloseTo(216, 6)
    // Only C-150 is excluded; the other eight stay filled.
    expect(figure.series.flatMap((entry) => entry.points).filter((point) => point.excluded)).toHaveLength(1)
  })

  it('draws the dashed, labelled percentage target', () => {
    const [line] = figure.refLines
    expect(figure.refLines).toHaveLength(1)
    expect(line?.id).toBe('target')
    expect(line?.axis).toBe('y')
    expect(line?.value).toBe(80)
    expect(line?.text).toBe('Target ≥ 80 %')
    expect(line?.x1).toBe(56)
    expect(line?.x2).toBe(824)
    expect(line?.y1).toBeCloseTo(105.714, 3)
    expect(line?.y2).toBeCloseTo(105.714, 3)
    expect(line?.labelX).toBe(820)
    expect(line?.labelY).toBeCloseTo(99.714, 3)
  })

  it('titles both axes with their units and legends the series', () => {
    expect(figure.xTitle).toBe('Load (L/m²)')
    expect(figure.yTitle).toBe('Step yield (%)')
    expect(figure.legend.map((item) => item.label)).toEqual(['Train A', 'Train B', 'Train C'])
    expect(figure.ariaLabel).toBe(
      'Line chart of Step yield (%) against Load (L/m²), for Train A, Train B, Train C, with Target ≥ 80 %, 9 rows',
    )
  })

  it('keeps the design polyline for every series', () => {
    expect(figure.series[2]?.line.map((point) => [Number(point.px.toFixed(1)), Number(point.py.toFixed(1))]))
      .toEqual([[184, 104.6], [440, 150.9], [696, 204]])
    expect(figure.series.every((entry) => entry.markers)).toBe(true)
  })

  it('plots a scatter figure as points without a connecting line', () => {
    const scatter = buildFigure(dataset, { ...stepYield, kind: 'scatter' })
    expect(scatter?.series[0]?.line).toEqual([])
    expect(scatter?.series[0]?.points).toHaveLength(3)
    const bare = buildFigure(dataset, { ...stepYield, showPoints: false })
    expect(bare?.series[0]?.markers).toBe(false)
    expect(bare?.series[0]?.line).toHaveLength(3)
  })
})

describe('turbidity figure (Analysis chart 2)', () => {
  const figure = buildFigure(dataset, turbidity, turbidityOptions)
  if (!figure) throw new Error('turbidity figure should build')

  it('uses the design plot rectangle and a fixed 0–30 NTU range', () => {
    expect(figure.plot).toEqual({ x: 56, y: 20, width: 768, height: 140 })
    expect(figure.y.domain).toEqual([0, 30])
    expect(figure.y.ticks.map((tick) => [tick.label, Number(tick.py.toFixed(1))]))
      .toEqual([['0', 160], ['10', 113.3], ['20', 66.7], ['30', 20]])
    // The 20 NTU gridline sits under the reference line; 0 rides the axis.
    expect(figure.gridlines).toHaveLength(3)
  })

  it('plots the turbidity values from the design', () => {
    const points = (index: number) => figure.series[index]?.points.map((point) => [Number(point.px.toFixed(1)), Number((point.py ?? 0).toFixed(1))])
    expect(points(0)).toEqual([[184, 131.1], [440, 114.3], [696, 74.1]])
    expect(points(1)).toEqual([[184, 140.9], [440, 133.9], [696, 118.5]])
    expect(figure.series[0]?.points.map((point) => point.valueY)).toEqual([6.2, 9.8, 18.4])
  })

  it('pins the off-scale excluded C-150 point above the plot with its value', () => {
    const excluded = figure.series[2]?.points[2]
    expect(excluded?.excluded).toBe(true)
    expect(excluded?.offScale).toBe(true)
    expect(excluded?.px).toBeCloseTo(696, 6)
    expect(excluded?.py).toBeCloseTo(8, 6)
    expect(excluded?.label).toBe('↑ 61.5')
    expect(excluded?.labelX).toBeCloseTo(708, 6)
    expect(excluded?.labelY).toBeCloseTo(18, 6)
  })

  it('clips the off-scale segment at the plot edge', () => {
    const line = figure.series[2]?.line ?? []
    expect(line.slice(0, 2).map((point) => [Number(point.px.toFixed(1)), Number(point.py.toFixed(1))]))
      .toEqual([[184, 100.7], [440, 46.6]])
    // The design's hand-authored endpoint is (620, 20); the exact intersection
    // with the plot top is 479.2 (see the COMP-03 report).
    expect(line[2]?.px).toBeCloseTo(479.2, 1)
    expect(line[2]?.py).toBeCloseTo(20, 6)
  })

  it('labels the 20 NTU limit and shows the shared x title', () => {
    expect(figure.refLines[0]?.text).toBe('Limit ≤ 20 NTU')
    expect(figure.xTitle).toBe('Load (L/m²)')
    expect(figure.yTitle).toBe('')
  })
})

describe('shared x axis', () => {
  it('lines the two Analysis charts up on the same load positions', () => {
    const group = buildFigureGroup(dataset, [
      { spec: stepYield, showYAxisTitle: false, showXAxisTitle: false },
      { spec: turbidity, ...turbidityOptions, showYAxisTitle: false, showXAxisTitle: true },
    ])
    if (!group) throw new Error('the stack should build')
    expect(group.sharedX.domain).toEqual([25, 175])
    expect(group.sharedX.ticks).toEqual([50, 100, 150])
    expect(group.figures).toHaveLength(2)

    const positions = (index: number) => group.figures[index]?.x.ticks.map((tick) => tick.px)
    expect(positions(0)).toEqual(positions(1))
    expect(positions(0)?.map((px) => Number(px.toFixed(1)))).toEqual([184, 440, 696])
    expect(group.figures[1]?.xTitle).toBe('Load (L/m²)')
    expect(group.figures[0]?.xTitle).toBe('')
  })

  it('widens the shared domain to cover both charts', () => {
    const group = buildFigureGroup(dataset, [
      { spec: stepYield },
      { spec: { ...stepYield, xMin: 0, xMax: 200 } },
    ])
    expect(group?.sharedX.domain).toEqual([0, 200])
    // A 200-unit span picks a 50-unit step, so the shared ticks are 0–200.
    expect(group?.sharedX.ticks).toEqual([0, 50, 100, 150, 200])
  })
})

describe('clipping', () => {
  it('keeps inside points and trims outside segments', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 }
    expect(clipPolyline([{ px: 10, py: 10 }, { px: 50, py: 50 }], box))
      .toEqual([{ px: 10, py: 10 }, { px: 50, py: 50 }])
    expect(clipPolyline([{ px: 50, py: 50 }, { px: 150, py: 50 }], box))
      .toEqual([{ px: 50, py: 50 }, { px: 100, py: 50 }])
    expect(clipPolyline([{ px: -20, py: -20 }, { px: -10, py: -10 }], box)).toEqual([])
  })
})

describe('labels', () => {
  it('appends a unit once', () => {
    expect(axisTitle('Step yield', '%', 'y')).toBe('Step yield (%)')
    expect(axisTitle('Step yield (%)', '%', 'y')).toBe('Step yield (%)')
    expect(axisTitle(undefined, undefined, 'Load')).toBe('Load')
  })

  it('composes reference labels from label, value and unit', () => {
    expect(referenceText('Target ≥', 80, '%')).toBe('Target ≥ 80 %')
    expect(referenceText('Limit ≤', 20.5, 'NTU')).toBe('Limit ≤ 20.5 NTU')
    expect(referenceText(undefined, 0, undefined)).toBe('0')
    expect(formatValue(61.5)).toBe('61.5')
    expect(formatValue(150)).toBe('150')
  })

  it('describes a figure for assistive technology', () => {
    expect(describeFigure(stepYield, 9, ['Train A', 'Train B', 'Train C']))
      .toBe('Line chart of Step yield (%) against Load (L/m²), for Train A, Train B, Train C, with Target ≥ 80 %, 9 rows')
  })
})

describe('figure metrics', () => {
  it('defaults to the design canonical metrics', () => {
    const figure = buildFigure(dataset, turbidity, turbidityOptions)
    if (!figure) throw new Error('the turbidity figure should build')
    expect(figure.metrics).toEqual({
      fontSize: 11, labelFontSize: 11, markerSize: 4, lineWidth: 1.6, strokeWidth: 1.4, refStrokeWidth: 1,
      triangleHalf: 4.5, triangleApexDy: -5, triangleHeight: 8,
    })
  })

  it('leaves the figure unchanged when metrics is absent or empty', () => {
    const plain = buildFigure(dataset, turbidity, turbidityOptions)
    const explicit = buildFigure(dataset, { ...turbidity, metrics: {} }, turbidityOptions)
    expect(explicit).toEqual(plain)
  })

  it('emits a larger metric set with the triangle marker scaled to it', () => {
    const figure = buildFigure(dataset, {
      ...turbidity,
      metrics: { fontSize: 15, labelFontSize: 14, markerSize: 5, lineWidth: 1.8, strokeWidth: 1.6 },
    }, turbidityOptions)
    if (!figure) throw new Error('the turbidity figure should build')
    expect(figure.metrics).toEqual({
      fontSize: 15, labelFontSize: 14, markerSize: 5, lineWidth: 1.8, strokeWidth: 1.6, refStrokeWidth: 1,
      triangleHalf: 5.625, triangleApexDy: -6.25, triangleHeight: 10,
    })
  })

  it('moves the x reference-line label with the text-size override', () => {
    const lineSpec = spec({
      x: 'Load', y: 'StepYield', xMin: 25, xMax: 175, yMin: 60, yMax: 95,
      refLines: [{ id: 'design', axis: 'x', value: 100, label: 'Design point' }],
    })
    const base = buildFigure(dataset, lineSpec)
    const large = buildFigure(dataset, { ...lineSpec, metrics: { fontSize: 15 } })
    if (!base || !large) throw new Error('the reference-line figure should build')
    expect(base.refLines[0]?.labelY).toBe(20 + 11)
    expect(large.refLines[0]?.labelY).toBe(20 + 15)
  })

  it('keeps the canonical values when an override is non-positive', () => {
    const figure = buildFigure(dataset, { ...turbidity, metrics: { fontSize: 0, markerSize: Number.NaN } }, turbidityOptions)
    if (!figure) throw new Error('the turbidity figure should build')
    expect(figure.metrics.fontSize).toBe(11)
    expect(figure.metrics.markerSize).toBe(4)
    expect(figure.metrics.labelFontSize).toBe(11)
  })

  it('changes box geometry with the stroke-width override', () => {
    const boxSpec = spec({ kind: 'box', x: 'Condition', y: 'StepYield', group: 'Train' })
    const base = buildFigure(dataset, boxSpec)
    const wide = buildFigure(dataset, { ...boxSpec, metrics: { strokeWidth: 1.8 } })
    if (!base || !wide) throw new Error('the box figure should build')
    expect(wide.boxes?.[0]?.width).not.toBe(base.boxes?.[0]?.width)
  })
})

describe('field roles', () => {
  it('reads the assignment out of a spec and writes it back', () => {
    const assigned = specWithRole(stepYield, 'series', 'Train')
    expect(rolesFromSpec(assigned)).toEqual({ x: 'Load', y: 'StepYield', series: 'Train' })
    expect(rolesFromSpec(specWithRole(assigned, 'y2', 'Turbidity')))
      .toEqual({ x: 'Load', y: 'StepYield', y2: 'Turbidity', series: 'Train' })
    expect(rolesFromSpec(specWithRole(assigned, 'series', undefined)))
      .toEqual({ x: 'Load', y: 'StepYield' })
  })

  it('lists dataset columns with the design role hints', () => {
    const fields = chartFieldsFromDataset(dataset, {
      units: { Load: 'L/m²', Turbidity: 'NTU', StepYield: '%' },
      calculated: [{ key: 'yield_calc', label: 'Step yield', kind: 'calculated', unit: '%', expression: 'out / in' }],
    })
    expect(fields).toHaveLength(7)
    expect(fields[6]?.kind).toBe('calculated')
    const assignment = rolesFromSpec(stepYield)
    expect(roleOf(assignment, 'Train')).toBe('series')
    expect(fieldHint(fields[2] as ChartField, assignment)).toBe('L/m² · x')
    expect(fieldHint(fields[5] as ChartField, assignment)).toBe('')
  })
})
