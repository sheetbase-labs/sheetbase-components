/// <reference path="../d3-scale.d.ts" />
import {
  areaY,
  barX,
  barY,
  binX,
  boxY,
  colorLegend,
  d3Curve,
  defineChart,
  dot,
  facetChart,
  group,
  linearRegressionY,
  lineY,
  link,
  rect,
  ruleX,
  ruleY,
  stack,
  text,
  tickY,
} from '@tanstack/charts'
import { tooltip } from '@tanstack/charts/tooltip'
import { portal } from '@tanstack/charts/tooltip/portal'
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

function numericExtent(rows: DataRow[], field: string) {
  let min = Infinity
  let max = -Infinity
  let found = false
  for (const row of rows) {
    const value = Number(row[field])
    if (!Number.isFinite(value)) continue
    found = true
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!found) return undefined
  if (min === max) return [min - 0.5, max + 0.5] as const
  return [min, max] as const
}

/** Positive data extent for a log axis; undefined when no usable values exist. */
function logExtent(rows: DataRow[], field: string): [number, number] | undefined {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const value = Number(row[field])
    if (!Number.isFinite(value) || value <= 0) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return undefined
  return [min, max]
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
  } else if (spec.kind === 'area') {
    marks.push(areaY(rows, ({ id: 'area', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
    marks.push(lineY(rows, ({ id: 'area-line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
  } else if (spec.kind === 'line') {
    marks.push(lineY(rows, ({ id: 'line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, points: spec.showPoints, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping, ...lineCurve }) as any))
  } else {
    const rendered = spec.kind === 'scatter' ? decimatePoints(rows, MAX_SCATTER_POINTS) : rows
    marks.push(dot(rendered, ({ id: 'points', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, r: spec.kind === 'scatter' && spec.size ? spec.size : spec.pointSize, fillOpacity: spec.pointOpacity, strokeOpacity: spec.pointOpacity, ...grouping }) as any))
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
  const extent = !horizontal && xMeta.kind === 'number' ? numericExtent(rawRows, spec.x) : undefined
  const zoomDomain = spec.zoomX && extent
    ? [Math.max(extent[0], spec.zoomX.start), Math.min(extent[1], spec.zoomX.end)] as [number, number]
    : undefined

  const xValueNumeric = horizontal ? yMeta?.kind === 'number' : xMeta.kind === 'number'
  const yValueNumeric = !horizontal && yMeta?.kind === 'number'
  const logAllowed = !['bar', 'horizontal-bar', 'histogram', 'area', 'lollipop'].includes(spec.kind)
  const xDataExtent = xValueNumeric ? numericExtent(rawRows, horizontal ? spec.y! : spec.x) : undefined
  const yDataExtent = yValueNumeric && spec.y ? numericExtent(rawRows, spec.y) : undefined
  const xLogExtent = logAllowed && xValueNumeric ? logExtent(rawRows, horizontal ? spec.y! : spec.x) : undefined
  const yLogExtent = logAllowed && yValueNumeric && spec.y ? logExtent(rawRows, spec.y) : undefined

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

  const xScale = horizontal
    ? (xValueNumeric ? numericScale(xKind) : () => scalePoint<string>().padding(0.5))
    : xMeta.kind === 'number'
      ? numericScale(xKind)
      : ['bar', 'box', 'lollipop'].includes(spec.kind) ? () => scaleBand<string>().padding(0.18) : () => scalePoint<string>().padding(0.5)
  const yScale = horizontal
    ? () => scaleBand<string>().padding(0.18)
    : spec.kind === 'histogram' ? scaleLinear : yValueNumeric ? numericScale(yKind) : () => scalePoint<string>().padding(0.5)

  // A numeric colour field becomes a gradient on scatter dots; connected
  // geometry (bars/lines) needs discrete series identity, so it stays ordinal.
  const colourMeta = spec.color ? dataset.columns.find((column) => column.key === spec.color) : undefined
  const continuousColour = spec.kind === 'scatter' && Boolean(spec.color)
    && (spec.colorScale === 'continuous' || (spec.colorScale !== 'categorical' && colourMeta?.kind === 'number'))
  const colourStops = spec.palette.length >= 2
    ? [spec.palette[0]!, spec.palette[Math.floor(spec.palette.length / 2)]!, spec.palette[spec.palette.length - 1]!]
    : spec.palette
  const color = semanticColour
    ? {
        scale: () => (continuousColour ? d3ScaleLinear().range(colourStops) : scaleOrdinal<string, string>().range(spec.palette)),
        ...(continuousColour ? { legend: colorLegend({ label: spec.color }) } : {}),
      }
    : undefined

  const xDomain: [number, number] | undefined = zoomDomain
    ? zoomDomain
    : xKind === 'log' && xLogExtent
      ? xLogExtent
      : horizontal && xValueNumeric && (spec.yMin !== undefined || spec.yMax !== undefined)
        ? [spec.yMin ?? 0, spec.yMax ?? Number(rawRows.reduce((max, row) => Math.max(max, Number(row[spec.y!] ?? 0)), 0))]
        : !horizontal && xMeta.kind === 'number' && (spec.xMin !== undefined || spec.xMax !== undefined)
          ? [spec.xMin ?? extent?.[0] ?? 0, spec.xMax ?? extent?.[1] ?? 1]
          : undefined
  const yDomain: [number, number] | undefined = yKind === 'log' && yLogExtent
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
