import {
  areaY,
  barX,
  barY,
  binX,
  boxY,
  defineChart,
  dot,
  facetChart,
  group,
  linearRegressionY,
  lineY,
  link,
  rect,
  stack,
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
import { ERROR_HIGH, ERROR_LOW, ROW_ID, filteredRows, preparedRows } from './explore'
import type { ChartSpec, DataRow, Dataset } from './types'

function visibleRows(rows: DataRow[], spec: ChartSpec) {
  const seriesField = spec.color ?? spec.group
  const hidden = new Set(spec.hiddenSeries ?? [])
  if (!seriesField || hidden.size === 0) return rows
  return rows.filter((row) => !hidden.has(String(row[seriesField] ?? '')))
}

// Explorer materialises rows locally, so raw scatter input is stride-sampled
// past this budget. Aggregated/grouped paths are unaffected; the regression
// overlay below still fits the full series.
const MAX_SCATTER_POINTS = 8000

export function decimatePoints(rows: DataRow[], max: number): DataRow[] {
  if (rows.length <= max) return rows
  const step = rows.length / max
  const sampled: DataRow[] = []
  for (let index = 0; index < max; index++) sampled.push(rows[Math.floor(index * step)]!)
  return sampled
}

function numericExtent(rows: DataRow[], field: string) {
  const values = rows.map((row) => Number(row[field])).filter(Number.isFinite)
  if (!values.length) return undefined
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [min - 0.5, max + 0.5] as const
  return [min, max] as const
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
  } else if (spec.kind === 'area') {
    marks.push(areaY(rows, ({ id: 'area', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, fillOpacity: spec.fillOpacity, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping }) as any))
    marks.push(lineY(rows, ({ id: 'area-line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping }) as any))
  } else if (spec.kind === 'line') {
    marks.push(lineY(rows, ({ id: 'line', x: spec.x, y: spec.y!, stroke: semanticColour ? undefined : markColour, points: spec.showPoints, strokeWidth: spec.lineWidth, strokeOpacity: spec.lineOpacity, ...grouping }) as any))
  } else {
    const rendered = spec.kind === 'scatter' ? decimatePoints(rows, MAX_SCATTER_POINTS) : rows
    marks.push(dot(rendered, ({ id: 'points', x: spec.x, y: spec.y!, fill: semanticColour ? undefined : markColour, stroke: semanticColour ? undefined : markColour, r: spec.pointSize, fillOpacity: spec.pointOpacity, strokeOpacity: spec.pointOpacity, ...grouping }) as any))
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

  const xScale = horizontal
    ? (yMeta?.kind === 'number' ? scaleLinear : () => scalePoint<string>().padding(0.5))
    : xMeta.kind === 'number' ? scaleLinear : ['bar', 'box'].includes(spec.kind) ? () => scaleBand<string>().padding(0.18) : () => scalePoint<string>().padding(0.5)
  const yScale = horizontal
    ? () => scaleBand<string>().padding(0.18)
    : spec.kind === 'histogram' ? scaleLinear : yMeta?.kind === 'number' ? scaleLinear : () => scalePoint<string>().padding(0.5)
  const color = semanticColour ? { scale: () => scaleOrdinal<string, string>().range(spec.palette) } : undefined

  const configuredX = horizontal && yMeta?.kind === 'number' && (spec.yMin !== undefined || spec.yMax !== undefined)
    ? scaleLinear().domain([spec.yMin ?? 0, spec.yMax ?? Number(rawRows.reduce((max, row) => Math.max(max, Number(row[spec.y!] ?? 0)), 0))])
    : zoomDomain
      ? scaleLinear().domain(zoomDomain)
      : !horizontal && xMeta.kind === 'number' && (spec.xMin !== undefined || spec.xMax !== undefined)
        ? scaleLinear().domain([spec.xMin ?? extent?.[0] ?? 0, spec.xMax ?? extent?.[1] ?? 1])
        : undefined
  const configuredY = !horizontal && yMeta?.kind === 'number' && (spec.yMin !== undefined || spec.yMax !== undefined)
    ? scaleLinear().domain([spec.yMin ?? Number(rawRows.reduce((min, row) => Math.min(min, Number(row[spec.y!] ?? min)), Infinity)), spec.yMax ?? Number(rawRows.reduce((max, row) => Math.max(max, Number(row[spec.y!] ?? max)), -Infinity))])
    : undefined

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
      x: { scale: (configuredX ?? xScale) as any, nice: configuredX ? false : horizontal ? yMeta?.kind === 'number' : xMeta.kind === 'number', grid: horizontal ? spec.showGrid : false, axis: { label: horizontal ? (spec.yLabel || spec.y) : (spec.xLabel || spec.x) } },
      y: { scale: (configuredY ?? yScale) as any, nice: configuredY ? false : horizontal ? false : spec.kind === 'histogram' || yMeta?.kind === 'number', grid: horizontal ? false : spec.showGrid, axis: { label: horizontal ? (spec.xLabel || spec.x) : spec.kind === 'histogram' ? (spec.yLabel || 'Count') : (spec.yLabel || spec.y) } },
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

  const specification = chartSpec(prepared, raw, dataset, spec, selectedRowId, onZoom)
  return specification ? defineChart(specification as any, interactionOptions(spec) as any) : null
}
