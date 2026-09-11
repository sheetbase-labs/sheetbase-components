/// <reference path="../d3-scale.d.ts" />
import {
  areaY,
  barX,
  barY,
  binX,
  binY,
  boxY,
  cell,
  colorGradientLegend,
  colorLegend,
  d3AreaXCurve,
  d3Curve,
  defineChart,
  dot,
  facetChart,
  group,
  linearRegressionY,
  lineY,
  link,
  normalize,
  rect,
  ruleX,
  ruleY,
  stack,
  text,
  tickY,
  violinY,
  waterfall,
} from '@tanstack/charts'
import { tooltip } from '@tanstack/charts/tooltip'
import { portal } from '@tanstack/charts/tooltip/portal'
import { pie, polar, radialArc } from '@tanstack/charts/polar'
import { zoomX, type ZoomXWindow } from '@tanstack/charts/interaction/zoom'
import { controlledSignal } from '@tanstack/charts/interaction/signal'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { scalePoint } from '@tanstack/charts/scales/point'
import { curveBasis, curveMonotoneX, curveStep } from 'd3-shape'
import { scaleLinear as d3ScaleLinear, scaleLog, scaleSqrt, scaleSymlog } from 'd3-scale'
import { ERROR_HIGH, ERROR_LOW, ROW_ID, filteredRows, preparedRows } from './explore'
import type { ChartSpec, DataRow, Dataset, ScaleKind } from './types'

function visibleRows(rows: DataRow[], spec: ChartSpec) {
  const seriesField = spec.color ?? spec.group
  const hidden = new Set(spec.hiddenSeries ?? [])
  if (!seriesField || hidden.size === 0) return rows
  return rows.filter((row) => !hidden.has(String(row[seriesField] ?? '')))
}

const MAX_SCATTER_POINTS = 8000

export function decimatePoints(rows: DataRow[], max: number): DataRow[] {
  if (rows.length <= max) return rows
  const step = rows.length / max
  const sampled: DataRow[] = []
  for (let index = 0; index < max; index++) sampled.push(rows[Math.floor(index * step)]!)
  return sampled
}

/** Both extents a numeric field can need, computed in a single scan. */
type FieldExtents = Readonly<{
  /** Full extent; `[min-0.5, max+0.5]` when all values coincide. */
  numeric?: readonly [number, number];
  /** Positive-only extent for log axes; undefined without two distinct positives. */
  positive?: readonly [number, number];
}>;

function scanExtents(rows: DataRow[], field: string): FieldExtents {
  let min = Infinity
  let max = -Infinity
  let found = false
  let positiveMin = Infinity
  let positiveMax = -Infinity
  for (const row of rows) {
    const value = Number(row[field])
    if (!Number.isFinite(value)) continue
    found = true
    if (value < min) min = value
    if (value > max) max = value
    if (value > 0) {
      if (value < positiveMin) positiveMin = value
      if (value > positiveMax) positiveMax = value
    }
  }
  return {
    numeric: !found ? undefined : min === max ? [min - 0.5, max + 0.5] as const : [min, max] as const,
    positive: Number.isFinite(positiveMin) && Number.isFinite(positiveMax) && positiveMin !== positiveMax ? [positiveMin, positiveMax] as const : undefined,
  }
}

function interactionOptions(spec: ChartSpec) {
  const grouped = spec.kind === 'line' || spec.kind === 'area'
  return {
    ...(grouped ? { focus: 'group-x' as const } : {}),
    maxFocusDistance: 96,
    tooltip: {
      use: tooltip,
      portal,
      anchor: grouped ? ('group-center' as const) : ('point' as const),
      placement: ['top', 'right', 'left', 'bottom'] as const,
      offset: 10,
      className: 'sheetbase-chart-tooltip',
    },
  }
}

function chartSpec(
  rows: DataRow[],
  rawRows: DataRow[],
  dataset: Dataset,
  spec: ChartSpec,
  selectedRowId?: number,
  onZoom?: (window: { start: number; end: number }) => void,
) {
  if (!spec.x) return null
  if (spec.kind !== 'histogram' && !spec.y) return null

  const xMeta = dataset.columns.find((column) => column.key === spec.x)
  const yMeta = dataset.columns.find((column) => column.key === spec.y)
  if (!xMeta || (spec.kind !== 'histogram' && !yMeta)) return null

  const marks: any[] = []
  const semanticColour = spec.color ?? spec.group
  const grouping: any = spec.group ? { z: spec.group, ...(spec.color ? { color: spec.color } : {}) } : spec.color ? { color: spec.color } : {}
  const markColour = spec.markColor ?? spec.primaryColor ?? spec.palette[0] ?? '#7652ef'

  const errorMode = spec.errorMode ?? (spec.errorLow && spec.errorHigh ? 'explicit' : 'none')
  const calculatedError = ['sd', 'sem', 'ci95'].includes(errorMode)
  const lowField = calculatedError ? ERROR_LOW : spec.errorLow
  const highField = calculatedError ? ERROR_HIGH : spec.errorHigh

  if (spec.showRawPoints && spec.y && !['histogram', 'horizontal-bar'].includes(spec.kind)) {
    marks.push(dot(decimatePoints(rawRows, MAX_SCATTER_POINTS), ({
      id: 'raw-points', x: spec.x, y: spec.y, r: Math.max(2, spec.pointSize - 2),
      fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour,
      fillOpacity: Math.min(0.36, spec.pointOpacity * 0.42), strokeOpacity: Math.min(0.28, spec.pointOpacity * 0.35),
      ...grouping,
    }) as any))
  }

  if (spec.showRibbon && lowField && highField && ['line', 'area'].includes(spec.kind)) {
    marks.push(areaY(rows, ({
      id: 'uncertainty-ribbon', x: spec.x, y1: lowField, y2: highField,
      fill: semanticColour ? undefined : markColour, fillOpacity: Math.min(0.18, spec.fillOpacity * 0.3),
      strokeOpacity: 0, ...grouping,
    }) as any))
  }

  if (errorMode !== 'none' && lowField && highField && !['histogram', 'box', 'horizontal-bar'].includes(spec.kind)) {
    marks.push(
      link(rows, ({ id: 'error-range', x1: spec.x, x2: spec.x, y1: lowField, y2: highField, stroke: semanticColour ? undefined : markColour, strokeOpacity: Math.min(1, spec.lineOpacity * 0.6), strokeWidth: Math.max(1, spec.lineWidth * 0.7), ...grouping }) as any),
      tickY(rows, ({ id: 'error-low-cap', x: spec.x, y: lowField, length: 7, stroke: semanticColour ? undefined : markColour, strokeOpacity: Math.min(1, spec.lineOpacity * 0.8), ...grouping }) as any),
      tickY(rows, ({ id: 'error-high-cap', x: spec.x, y: highField, length: 7, stroke: semanticColour ? undefined : markColour, strokeOpacity: Math.min(1, spec.lineOpacity * 0.8), ...grouping }) as any),
    )
  }

  const barLayout = spec.barLayout === 'grouped' && semanticColour
    ? group({ padding: 0.18 })
    : spec.barLayout === 'normalized' && semanticColour
      ? stack({ offset: 'normalize' })
      : undefined

  const curve = spec.lineCurve === 'smooth' ? d3Curve(curveBasis)
    : spec.lineCurve === 'step' ? d3Curve(curveStep)
      : spec.lineCurve === 'monotone' ? d3Curve(curveMonotoneX)
        : undefined
  const lineCurve = curve ? { curve } : {}

  if (spec.kind === 'histogram') {
    if (xMeta.kind !== 'number') return null
    const bins = binX(rows, ({ value: (row: DataRow) => Number(row[spec.x!]), thresholds: Math.max(3, Math.round(spec.histogramBins)), outputs: { count: { reduce: 'count' } } }) as any)
    marks.push(rect(bins as any, ({ id: 'histogram', x1: 'x1', x2: 'x2', y1: () => 0, y2: 'count', inset: spec.barGap, radius: spec.barRadius, fill: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, ...(spec.color ? { color: spec.color } : {}) }) as any))
  } else if (spec.kind === 'box') {
    if (!spec.y || yMeta?.kind !== 'number') return null
    marks.push(boxY(rows, ({ id: 'box', x: spec.x, y: spec.y, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, ...(semanticColour ? { color: semanticColour } : {}), r: Math.max(2, spec.pointSize - 1), fillOpacity: spec.fillOpacity, strokeOpacity: spec.lineOpacity }) as any))
  } else if (spec.kind === 'horizontal-bar') {
    marks.push(barX(rows, ({ id: 'horizontal-bars', y: spec.x, x: spec.y!, inset: spec.barGap, radius: spec.barRadius, fill: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, layout: barLayout, ...grouping }) as any))
  } else if (spec.kind === 'bar') {
    marks.push(barY(rows, ({ id: 'bars', x: spec.x, y: spec.y!, inset: spec.barGap, radius: spec.barRadius, fill: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, layout: barLayout, ...grouping }) as any))
  } else if (spec.kind === 'lollipop') {
    // Thin stem plus a dot head; preparedRows has already summarised y.
    marks.push(barY(rows, ({ id: 'lollipop-stem', x: spec.x, y: spec.y!, maxThickness: Math.max(2, Math.round(spec.lineWidth + 1)), radius: spec.barRadius, fill: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, layout: barLayout, ...grouping }) as any))
    marks.push(dot(rows, ({ id: 'lollipop-head', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, r: spec.pointSize, ...grouping }) as any))
  } else if (spec.kind === 'violin') {
    if (!spec.y || yMeta?.kind !== 'number') return null
    const bins = binY(rows, { value: spec.y, by: spec.x, thresholds: Math.max(3, Math.round(spec.histogramBins)), outputs: { count: { reduce: 'count' } } } as any) as any[]
    const profiles = normalize(bins, { value: 'count', by: spec.x, basis: 'max', as: 'width' } as any) as any[]
    marks.push(violinY(profiles, ({ id: 'violin', x: spec.x, y: 'y', width: 'width', span: 0.8, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, strokeOpacity: spec.lineOpacity, ...(semanticColour ? { color: semanticColour } : {}), curve: d3AreaXCurve(curveBasis) }) as any))
  } else if (spec.kind === 'waterfall') {
    if (!spec.y) return null
    // Sum contributions per category, then let the transform lay them out as
    // cumulative intervals.
    const buckets = new Map<string, number>()
    for (const row of rows) {
      const key = String(row[spec.x] ?? '')
      buckets.set(key, (buckets.get(key) ?? 0) + (Number(row[spec.y]) || 0))
    }
    const steps = waterfall([...buckets].map(([x, value]) => ({ x, value })) as any, { value: 'value' } as any) as any[]
    marks.push(barY(steps, ({ id: 'waterfall', x: 'x', y: 'end', y1: 'start', y2: 'end', fill: semanticColour ? undefined : markColour, stroke: markColour, strokeWidth: 1, fillOpacity: spec.fillOpacity, ...(semanticColour ? { color: semanticColour } : {}) }) as any))
  } else if (spec.kind === 'heatmap') {
    if (!spec.x || !spec.y) return null
    const buckets = new Map<string, { x: string; y: string; sum: number; n: number; min: number; max: number }>()
    for (const row of rows) {
      const xv = String(row[spec.x] ?? '')
      const yv = String(row[spec.y] ?? '')
      if (!xv || !yv) continue
      const value = spec.size ? Number(row[spec.size]) : 1
      if (!Number.isFinite(value)) continue
      const bucket = buckets.get(`${xv}\u0000${yv}`) ?? { x: xv, y: yv, sum: 0, n: 0, min: Infinity, max: -Infinity }
      bucket.sum += value
      bucket.n += 1
      bucket.min = Math.min(bucket.min, value)
      bucket.max = Math.max(bucket.max, value)
      buckets.set(`${xv}\u0000${yv}`, bucket)
    }
    const mode = !spec.size ? 'count' : spec.aggregate === 'mean' ? 'mean' : spec.aggregate === 'min' ? 'min' : spec.aggregate === 'max' ? 'max' : spec.aggregate === 'count' ? 'count' : 'sum'
    const cells = [...buckets.values()].map((bucket) => ({ x: bucket.x, y: bucket.y, value: mode === 'count' ? bucket.n : mode === 'mean' ? bucket.sum / bucket.n : mode === 'min' ? bucket.min : mode === 'max' ? bucket.max : bucket.sum }))
    marks.push(cell(cells, ({ id: 'heatmap', x: 'x', y: 'y', color: 'value', inset: spec.barGap, radius: spec.barRadius }) as any))
  } else if (spec.kind === 'area') {
    marks.push(areaY(rows, ({ id: 'area', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
    marks.push(lineY(rows, ({ id: 'area-line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
  } else if (spec.kind === 'line') {
    marks.push(lineY(rows, ({ id: 'line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, points: spec.showPoints, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
  } else {
    const rendered = spec.kind === 'scatter' ? decimatePoints(rows, MAX_SCATTER_POINTS) : rows
    marks.push(dot(rendered, ({ id: 'points', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, r: spec.kind === 'scatter' && spec.size ? spec.size : spec.pointSize, fillOpacity: spec.pointOpacity, strokeOpacity: spec.pointOpacity, ...grouping }) as any))
  }

  if (spec.labels && spec.x && spec.y && ['scatter', 'line', 'area', 'bar', 'lollipop'].includes(spec.kind)) {
    const labelField = spec.labelField
    marks.push(text(rows as any, ({
      id: 'data-labels', x: spec.x, y: spec.y,
      text: labelField
        ? (row: DataRow) => String(row[labelField] ?? '')
        : (row: DataRow) => { const value = Number(row[spec.y!]); return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '' },
      dy: spec.kind === 'bar' || spec.kind === 'lollipop' ? -6 : -8,
      anchor: 'middle', fill: '#52525b', fontSize: 10, fontWeight: 600,
    } as any) as any))
  }

  if (spec.y2) {
    // Second measure on its own right-hand axis, aggregated over the same
    // dimensions as the primary so the line tracks the marks.
    const dims = [spec.x, spec.group, spec.color, spec.facet].filter((value): value is string => Boolean(value))
    const sums = new Map<string, { sum: number; n: number }>()
    for (const row of rawRows) {
      const value = Number(row[spec.y2])
      if (!Number.isFinite(value)) continue
      const key = JSON.stringify(dims.map((dim) => row[dim]))
      const bucket = sums.get(key) ?? { sum: 0, n: 0 }
      bucket.sum += value
      bucket.n += 1
      sums.set(key, bucket)
    }
    const secondaryRows = rows.map((row) => {
      const bucket = sums.get(JSON.stringify(dims.map((dim) => row[dim])))
      return { ...row, __secondary: bucket && bucket.n ? bucket.sum / bucket.n : undefined }
    })
    marks.push(lineY(secondaryRows, ({ id: 'secondary', x: spec.x, y: '__secondary', yScale: 'y2', stroke: spec.palette[1] ?? '#07956a', strokeWidth: Math.max(1.5, spec.lineWidth), strokeOpacity: spec.lineOpacity, points: spec.showPoints } as any) as any))
  }

  if (spec.refLines?.length) {
    for (const line of spec.refLines) {
      const guide = [{ x: line.value, y: line.value }]
      if (line.axis === 'x') marks.push(ruleX(guide, { id: `ref-x-${line.id}`, x: 'x', stroke: markColour, strokeOpacity: 0.55, strokeWidth: 1, strokeDasharray: '4 4' }) as any)
      else marks.push(ruleY(guide, { id: `ref-y-${line.id}`, y: 'y', stroke: markColour, strokeOpacity: 0.55, strokeWidth: 1, strokeDasharray: '4 4' }) as any)
      if (line.label) {
        marks.push(text(guide, ({ id: `ref-label-${line.id}`, ...(line.axis === 'x' ? { x: 'x' } : { y: 'y' }), text: line.label, fill: markColour, fontSize: 10, fontWeight: 600 } as any) as any))
      }
    }
  }

  if (spec.showRegression && spec.kind === 'scatter' && xMeta.kind === 'number' && yMeta?.kind === 'number') {
    marks.push(linearRegressionY(rawRows, ({
      id: 'regression', x: spec.x, y: spec.y!, z: spec.group ?? spec.color,
      ci: 0.95, strokeWidth: Math.max(1.5, spec.lineWidth), strokeOpacity: Math.min(1, spec.lineOpacity), fillOpacity: 0.08,
    }) as any))
  }

  if (selectedRowId !== undefined && spec.kind === 'scatter') {
    const selected = rawRows.filter((row) => row[ROW_ID] === selectedRowId)
    if (selected.length) marks.push(dot(selected, ({ id: 'selected-point', x: spec.x, y: spec.y!, r: spec.pointSize + 4, fillOpacity: 0, stroke: '#171717', strokeWidth: 2 }) as any))
  }

  const horizontal = spec.kind === 'horizontal-bar'
  const xValueNumeric = horizontal ? yMeta?.kind === 'number' : xMeta.kind === 'number'
  const yValueNumeric = !horizontal && yMeta?.kind === 'number'
  const logAllowed = !['bar', 'horizontal-bar', 'histogram', 'area', 'lollipop', 'waterfall', 'heatmap'].includes(spec.kind)

  // One pass per numeric field per build serves the numeric and log extents.
  const fieldExtents = new Map<string, FieldExtents>()
  const extentsFor = (field: string): FieldExtents => {
    let found = fieldExtents.get(field)
    if (!found) {
      found = scanExtents(rawRows, field)
      fieldExtents.set(field, found)
    }
    return found
  }
  const xField = horizontal ? spec.y! : spec.x
  const xExtents = xValueNumeric && xField ? extentsFor(xField) : undefined
  const yExtents = yValueNumeric && spec.y ? extentsFor(spec.y) : undefined

  const extent = !horizontal && xMeta.kind === 'number' ? xExtents?.numeric : undefined
  const zoomDomain = spec.zoomX && extent
    ? [Math.max(extent[0], spec.zoomX.start), Math.min(extent[1], spec.zoomX.end)] as [number, number]
    : undefined

  const xDataExtent = xExtents?.numeric
  const yDataExtent = yExtents?.numeric
  const xLogExtent = logAllowed ? xExtents?.positive : undefined
  const yLogExtent = logAllowed ? yExtents?.positive : undefined

  // Pick an effective scale, falling back to linear when the data can't support
  // the request (log needs positive values + a non-zero baseline; sqrt needs
  // non-negative values).
  const resolveKind = (requested: ScaleKind | undefined, extent: readonly [number, number] | undefined, logExt: readonly [number, number] | undefined): ScaleKind => {
    const kind = requested && requested !== 'auto' ? requested : 'linear'
    if (kind === 'log') return logExt ? 'log' : 'linear'
    if (kind === 'sqrt') return extent && extent[0] >= 0 ? 'sqrt' : 'linear'
    return kind
  }
  const xKind = resolveKind(spec.xScale, xDataExtent, xLogExtent)
  const yKind = resolveKind(spec.yScale, yDataExtent, yLogExtent)
  const numericScale = (kind: ScaleKind) =>
    kind === 'log' ? scaleLog : kind === 'sqrt' ? scaleSqrt : kind === 'symlog' ? scaleSymlog : scaleLinear

  // Optional ordering of categorical x (or y for horizontal bars), ranked by
  // the summed y value.
  const categoryOrder = spec.categoryOrder && spec.categoryOrder !== 'auto' ? spec.categoryOrder : undefined
  let categoryDomain: string[] | undefined
  if (categoryOrder && !xValueNumeric && spec.x) {
    const totals = new Map<string, number>()
    for (const row of rawRows) {
      const key = String(row[spec.x] ?? '')
      if (!key) continue
      const value = spec.y ? Number(row[spec.y]) : 1
      totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(value) ? value : 0))
    }
    categoryDomain = [...totals.keys()].sort(categoryOrder === 'label-asc'
      ? (a, b) => a.localeCompare(b)
      : categoryOrder === 'value-asc'
        ? (a, b) => (totals.get(a) ?? 0) - (totals.get(b) ?? 0)
        : (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
  }

  const bandPadding = spec.kind === 'heatmap' ? 0.05 : 0.18
  const xBand = categoryDomain
    ? scaleBand<string>().domain(categoryDomain).padding(bandPadding)
    : () => scaleBand<string>().padding(bandPadding)
  const xPoint = categoryDomain
    ? scalePoint<string>().domain(categoryDomain).padding(0.5)
    : () => scalePoint<string>().padding(0.5)

  const xScale = horizontal
    ? (xValueNumeric ? numericScale(xKind) : xPoint)
    : xMeta.kind === 'number'
      ? numericScale(xKind)
      : ['bar', 'box', 'lollipop', 'violin', 'waterfall', 'heatmap'].includes(spec.kind)
        ? xBand
        : xPoint
  const yScale = horizontal
    ? xBand
    : spec.kind === 'histogram' ? scaleLinear
      : spec.kind === 'heatmap' ? xBand
        : yValueNumeric ? numericScale(yKind) : xPoint

  // A numeric colour field becomes a gradient on scatter dots; a heatmap always
  // colours by its aggregated value. Connected geometry (bars/lines) needs
  // discrete series identity, so it stays ordinal.
  const heatmap = spec.kind === 'heatmap'
  const colourMeta = spec.color ? dataset.columns.find((column) => column.key === spec.color) : undefined
  const continuousColour = spec.kind === 'scatter' && Boolean(spec.color)
    && (spec.colorScale === 'continuous' || (spec.colorScale !== 'categorical' && colourMeta?.kind === 'number'))
  const gradient = heatmap || continuousColour
  const colourStops = spec.palette.length >= 2
    ? [spec.palette[0]!, spec.palette[Math.floor(spec.palette.length / 2)]!, spec.palette[spec.palette.length - 1]!]
    : spec.palette
  const color = semanticColour || heatmap
    ? {
        scale: () => (gradient ? d3ScaleLinear().range(colourStops) : scaleOrdinal<string, string>().range(spec.palette)),
        ...(gradient
          ? { legend: heatmap ? colorGradientLegend({ label: spec.size ?? 'count' }) : colorLegend({ label: spec.color }) }
          : {}),
      }
    : undefined

  const xDomain: readonly [number, number] | undefined = zoomDomain
    ? zoomDomain
    : xKind === 'log' && xLogExtent
      ? xLogExtent
      : horizontal && xValueNumeric && (spec.yMin !== undefined || spec.yMax !== undefined)
        ? [spec.yMin ?? 0, spec.yMax ?? Number(rawRows.reduce((max, row) => Math.max(max, Number(row[spec.y!] ?? 0)), 0))]
        : !horizontal && xMeta.kind === 'number' && (spec.xMin !== undefined || spec.xMax !== undefined)
          ? [spec.xMin ?? extent?.[0] ?? 0, spec.xMax ?? extent?.[1] ?? 1]
          : undefined
  const yDomain: readonly [number, number] | undefined = yKind === 'log' && yLogExtent
    ? yLogExtent
    : yValueNumeric && spec.y && (spec.yMin !== undefined || spec.yMax !== undefined)
      ? [spec.yMin ?? Number(rawRows.reduce((min, row) => Math.min(min, Number(row[spec.y!] ?? min)), Infinity)), spec.yMax ?? Number(rawRows.reduce((max, row) => Math.max(max, Number(row[spec.y!] ?? max)), -Infinity))]
      : undefined
  const configuredX = xDomain ? numericScale(xKind)().domain(xDomain) : undefined
  const configuredY = yDomain ? numericScale(yKind)().domain(yDomain) : undefined

  const controls = spec.zoomEnabled && extent && onZoom && xMeta.kind === 'number' && !horizontal
    ? [zoomX({
        window: controlledSignal<ZoomXWindow<number>, any>(
          { start: zoomDomain?.[0] ?? extent[0], end: zoomDomain?.[1] ?? extent[1] },
          (next) => onZoom({ start: next.start, end: next.end }),
        ),
        extent: [extent[0], extent[1]],
        scaleExtent: [1, 20],
        ariaLabel: 'Zoom and pan x axis',
      })]
    : undefined

  return {
    marks,
    scales: {
      x: { scale: (configuredX ?? xScale) as any, reverse: spec.xReverse ?? false, nice: configuredX ? false : horizontal ? yMeta?.kind === 'number' : xMeta.kind === 'number', grid: horizontal ? spec.showGrid : false, axis: { label: horizontal ? (spec.yLabel || spec.y) : (spec.xLabel || spec.x) } },
      y: { scale: (configuredY ?? yScale) as any, reverse: spec.yReverse ?? false, nice: configuredY ? false : horizontal ? false : spec.kind === 'histogram' || yMeta?.kind === 'number', grid: horizontal ? false : spec.showGrid, axis: { label: horizontal ? (spec.xLabel || spec.x) : spec.kind === 'histogram' ? (spec.yLabel || 'Count') : (spec.yLabel || spec.y) } },
      ...(spec.y2 ? { y2: { channel: 'y' as const, scale: scaleLinear as any, nice: true, grid: false, axis: { label: spec.y2, side: 'right' as const } } } : {}),
    },
    ...(color ? { color } : {}),
    ...(controls ? { controls } : {}),
    clip: true,
  }
}

export function buildChart(
  dataset: Dataset,
  spec: ChartSpec,
  selectedRowId?: number,
  onZoom?: (window: { start: number; end: number }) => void,
) {
  const prepared = visibleRows(preparedRows(dataset, spec), spec)
  const raw = visibleRows(filteredRows(dataset, spec), spec)

  if (spec.kind === 'pie' || spec.kind === 'donut') {
    if (!spec.x || !spec.y) return null
    const totals = new Map<string, number>()
    for (const row of raw) {
      const key = String(row[spec.x] ?? '')
      if (!key) continue
      const value = Number(row[spec.y] ?? 0)
      totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(value) ? value : 0))
    }
    const slices = pie([...totals].map(([category, value]) => ({ category, value })), { value: 'value' } as any)
    return defineChart({
      marks: [polar({
        inset: 8,
        radiusRatio: 0.82,
        marks: [radialArc(slices, ({
          innerRadius: spec.kind === 'donut' ? ({ radius }: { radius: number }) => radius * 0.58 : 0,
          cornerRadius: spec.barRadius,
          color: 'category',
          key: 'category',
          fillOpacity: spec.fillOpacity,
        } as any) as any)],
        scales: { angle: null, radius: null },
      } as any) as any],
      scales: { x: null, y: null },
      color: { scale: () => scaleOrdinal<string, string>().range(spec.palette), legend: colorLegend({ label: spec.x }) },
    } as any) as any
  }

  if (spec.facet) {
    const facetMeta = dataset.columns.find((column) => column.key === spec.facet)
    // Faceting a field the chart can't render (e.g. histogram over a date) would
    // hand `null` to facetChart and crash; and a high-cardinality facet would
    // render thousands of cells. Fall back to a single chart in both cases.
    const canFacet = !facetMeta || facetMeta.uniqueCount <= 60
    if (canFacet && chartSpec(prepared, raw, dataset, { ...spec, facet: undefined }, selectedRowId, onZoom)) {
      const faceted = facetChart(prepared, ({
        by: spec.facet,
        columns: 2,
        minWidth: 240,
        gap: 14,
        axes: 'cell',
        label: (value: unknown) => String(value),
        chart(groupRows: readonly DataRow[]) {
          const facetValue = String(groupRows[0]?.[spec.facet!] ?? '')
          const rawFacet = raw.filter((row) => String(row[spec.facet!] ?? '') === facetValue)
          return chartSpec([...groupRows], rawFacet, dataset, { ...spec, facet: undefined }, selectedRowId, onZoom) as any
        },
      }) as any) as any
      return defineChart(faceted as any, interactionOptions(spec) as any)
    }
  }

  const specification = chartSpec(prepared, raw, dataset, spec, selectedRowId, onZoom)
  return specification ? defineChart(specification as any, interactionOptions(spec) as any) : null
}
