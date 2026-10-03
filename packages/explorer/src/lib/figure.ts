/**
 * COMP-03: the static v3 figure model.
 *
 * `App`'s interactive stage renders a TanStack chart definition (see
 * `chart.ts`); a notebook figure, a report export and the Analysis screen need
 * a deterministic, self-contained figure instead — spec in, SVG out, with the
 * design's rules (series-a/b/c with circle/square/triangle markers, hollow
 * excluded points, dashed labelled reference lines, quiet axes and fine
 * gridlines). This module computes that geometry as plain data; `Chart.tsx`
 * renders it and tests assert it, so the same numbers appear in the figure, in
 * an exported SVG and in a fixture test.
 *
 * Colours are theme-variable tokens throughout (COMP-01): the SVG applies them
 * as inline styles, which — unlike presentation attributes — resolve `var()`.
 */
import { ROW_ID, preparedRows, visibleRows } from './explore'
import type { ChartSpec, DataRow, Dataset, ScaleKind } from './types'

export type FigureMarker = 'circle' | 'square' | 'triangle'

/** Marker shape and colour for a series, both chosen by series index. */
export interface FigureMarkerStyle {
  marker: FigureMarker
  /** Theme token, e.g. `var(--series-a)`. */
  colour: string
}

const SERIES_TOKENS = ['var(--series-a)', 'var(--series-b)', 'var(--series-c)'] as const
const MARKERS: readonly FigureMarker[] = ['circle', 'square', 'triangle']

/** v3 rules: circle/square/triangle and series-a/b/c cycle together by index. */
export function seriesStyle(index: number): FigureMarkerStyle {
  return {
    marker: MARKERS[index % MARKERS.length] as FigureMarker,
    colour: SERIES_TOKENS[index % SERIES_TOKENS.length] as string,
  }
}

/** Theme variables the figure draws with — never literals (COMP-01 lint). */
export const FIGURE_TOKENS = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  label: 'var(--chart-label)',
  danger: 'var(--danger-text)',
  surface: 'var(--surface)',
} as const

export interface FigurePadding {
  top: number
  right: number
  bottom: number
  left: number
}

/** Design geometry (canvas/Analysis.dc.html, Notebook.dc.html Figure 1). */
export const FIGURE_LAYOUT = {
  width: 844,
  height: 262,
  padding: { top: 20, right: 20, bottom: 42, left: 56 },
  lineWidth: 1.6,
  /** Marker radius / half-size, in figure units. */
  markerSize: 4,
  /** Triangle marker: half-width, apex offset from the point, and height. */
  triangleHalf: 4.5,
  triangleApexDy: -5,
  triangleHeight: 8,
  strokeWidth: 1.4,
  fontSize: 11,
  /** `stroke-dasharray` for reference lines. */
  refDash: '4 3',
  /** Baseline offsets from the plot rect, as fractions of the design canvas. */
  tickOffset: 22,
  titleOffset: 36,
  tickGap: 8,
  /** Value-position → text-baseline offset for a y tick. */
  yTickBaseline: 4,
  yTitleX: 14,
  refLabelInset: 4,
  refLabelDy: -6,
  excludedLabelDx: 10,
  excludedLabelDy: 12,
  offScaleGap: 12,
  offScaleLabelDx: 12,
  offScaleLabelDy: 10,
} as const

export interface FigureBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FigurePoint {
  /** `ROW_ID` of the source row; hosts use it for selection. */
  rowId?: number
  valueX: number
  valueY?: number
  /** Pixel position inside the plot. For an off-scale point `py` is the pinned edge. */
  px: number
  py?: number
  /** Excluded from the decision — drawn hollow. */
  excluded: boolean
  /** Outside the y domain; its marker is pinned at the plot edge. */
  offScale?: boolean
  /** Text drawn beside an excluded marker ("flagged", "↑ 61.5"). */
  label?: string
  labelX?: number
  labelY?: number
  /** Position in the series' source order. */
  index: number
}

export interface FigureSeries {
  id: string
  label: string
  style: FigureMarkerStyle
  points: FigurePoint[]
  /** Polyline through the plotted points, clipped to the plot rectangle. */
  line: Array<{ px: number; py: number }>
  /** Draw a marker at every point (`showPoints`); excluded points always show one. */
  markers: boolean
}

export interface FigureTick {
  value: number
  px: number
  py: number
  label: string
}

export interface FigureAxis {
  /** Design label, already carrying its unit ("Load (L/m²)"). */
  title: string
  domain: readonly [number, number]
  ticks: FigureTick[]
}

export interface FigureReferenceLine {
  id: string
  axis: 'x' | 'y'
  value: number
  /** Composed from label + value + unit, e.g. `Target ≥ 80 %`. */
  text: string
  x1: number
  y1: number
  x2: number
  y2: number
  labelX: number
  labelY: number
}

export interface FigureLegendItem {
  label: string
  style: FigureMarkerStyle
}

export interface FigureModel {
  width: number
  height: number
  plot: FigureBox
  x: FigureAxis
  y: FigureAxis
  gridlines: number[]
  series: FigureSeries[]
  refLines: FigureReferenceLine[]
  legend: FigureLegendItem[]
  /** Axis titles the renderer should draw (empty when suppressed). */
  xTitle: string
  yTitle: string
  ariaLabel: string
}

export interface FigureOptions {
  /** Figure units (SVG viewBox). Defaults to the design's 844×262. */
  width?: number
  height?: number
  padding?: Partial<FigurePadding>
  /** Draw the axis titles; the design's compact Analysis stack hides both. */
  showXAxisTitle?: boolean
  showYAxisTitle?: boolean
  /**
   * A shared x axis from `buildFigureGroup`: the domain and ticks every chart
   * in the stack uses, so their points line up vertically.
   */
  sharedX?: Pick<FigureAxis, 'domain' | 'ticks'> | null
}

// ---------------------------------------------------------------------------
// Scales and ticks
// ---------------------------------------------------------------------------

type Scale = (value: number) => number

function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  if (span === 0) return () => (r0 + r1) / 2
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

const NICE_STEPS = [1, 2, 2.5, 5, 10]

/** Nice tick step for a domain span, targeting ~4 ticks. */
export function niceStep(span: number, target = 4): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const rough = span / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / magnitude
  const step = NICE_STEPS.find((candidate) => scaled <= candidate) ?? 10
  return step * magnitude
}

/** Tick values inside a domain at a nice step. */
export function niceTicks(domain: readonly [number, number], target = 4): number[] {
  const step = niceStep(domain[1] - domain[0], target)
  const start = Math.ceil(domain[0] / step) * step
  const ticks: number[] = []
  const epsilon = step / 1e6
  for (let value = start; value <= domain[1] + epsilon; value += step) {
    if (value >= domain[0] - epsilon) ticks.push(Number(value.toPrecision(12)))
  }
  return ticks
}

/** Data extent for a numeric field, ignoring non-finite values. */
function fieldExtent(rows: DataRow[], field: string): readonly [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let found = false
  for (const row of rows) {
    const value = Number(row[field])
    if (!Number.isFinite(value)) continue
    found = true
    if (value < min) min = value
    if (value > max) max = value
  }
  return found ? [min, max] : undefined
}

/**
 * Domain for an axis: the spec's explicit min/max when given (the Analysis
 * screen's fixed ranges), else the data extent widened to the next nice step so
 * marks are never glued to the axis line.
 */
export function figureDomain(
  min: number | undefined,
  max: number | undefined,
  extent: readonly [number, number] | undefined,
): readonly [number, number] {
  if (min !== undefined && max !== undefined && max > min) return [min, max]
  const lo = min ?? extent?.[0] ?? 0
  const hi = max ?? extent?.[1] ?? 1
  if (hi <= lo) return [lo - 0.5, lo + 0.5]
  const step = niceStep(hi - lo)
  return [min ?? Math.floor(lo / step) * step, max ?? Math.ceil(hi / step) * step]
}

/** The scales a v3 figure supports; `log` and `sqrt` match the explorer's. */
function scaleFor(kind: ScaleKind | undefined): (domain: readonly [number, number], range: readonly [number, number]) => Scale {
  if (kind === 'log') {
    return (domain, range) => {
      if (domain[0] <= 0 || domain[1] <= 0) return linearScale(domain, range)
      const log = linearScale([Math.log10(domain[0]), Math.log10(domain[1])], range)
      return (value) => log(Math.log10(value))
    }
  }
  if (kind === 'sqrt') {
    return (domain, range) => {
      if (domain[0] < 0) return linearScale(domain, range)
      const sqrt = linearScale([Math.sqrt(domain[0]), Math.sqrt(domain[1])], range)
      return (value) => sqrt(Math.sqrt(value))
    }
  }
  return linearScale
}

// ---------------------------------------------------------------------------
// Polyline clipping (Liang–Barsky per segment)
// ---------------------------------------------------------------------------

type Segment = readonly [number, number, number, number]

function clipSegment(segment: Segment, box: FigureBox): Segment | undefined {
  const [x1, y1, x2, y2] = segment
  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0
  let t1 = 1
  const p: readonly number[] = [-dx, dx, -dy, dy]
  const q: readonly number[] = [x1 - box.x, box.x + box.width - x1, y1 - box.y, box.y + box.height - y1]
  for (let edge = 0; edge < 4; edge++) {
    const pi = p[edge] as number
    const qi = q[edge] as number
    if (pi === 0) {
      if (qi < 0) return undefined
      continue
    }
    const t = qi / pi
    if (pi < 0) {
      if (t > t1) return undefined
      if (t > t0) t0 = t
    } else {
      if (t < t0) return undefined
      if (t < t1) t1 = t
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy]
}

/**
 * Clip a polyline to the plot rectangle, keeping contiguous runs. Off-scale
 * points therefore stop at the plot edge instead of bleeding over the axis
 * labels — the design clips its turbidity line the same way.
 */
export function clipPolyline(points: ReadonlyArray<{ px: number; py: number }>, box: FigureBox): Array<{ px: number; py: number }> {
  if (points.length < 2) return [...points]
  const out: Array<{ px: number; py: number }> = []
  const push = (px: number, py: number) => {
    const last = out[out.length - 1]
    if (last && Math.abs(last.px - px) < 1e-9 && Math.abs(last.py - py) < 1e-9) return
    out.push({ px, py })
  }
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as { px: number; py: number }
    const to = points[i + 1] as { px: number; py: number }
    const clipped = clipSegment([from.px, from.py, to.px, to.py], box)
    if (!clipped) continue
    push(clipped[0], clipped[1])
    push(clipped[2], clipped[3])
  }
  return out
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** `Step yield` + `%` → `Step yield (%)`; already-suffixed labels pass through. */
export function axisTitle(label: string | undefined, unit: string | undefined, fallback: string): string {
  const name = (label ?? '').trim() || fallback
  const suffix = (unit ?? '').trim()
  if (!suffix || name.includes(`(${suffix})`)) return name
  return `${name} (${suffix})`
}

/** Compact number rendering: integers stay integral, others keep 2 decimals. */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(2)))
}

/** `Target ≥` + `80` + `%` → `Target ≥ 80 %`. */
export function referenceText(label: string | undefined, value: number, unit: string | undefined): string {
  return [label?.trim(), formatValue(value), unit?.trim()].filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Figure building
// ---------------------------------------------------------------------------

function seriesRows(rows: DataRow[], field: string | undefined): Array<{ id: string; label: string; rows: DataRow[] }> {
  if (!field) return [{ id: '', label: '', rows }]
  const groups = new Map<string, DataRow[]>()
  for (const row of rows) {
    const id = String(row[field] ?? '')
    const bucket = groups.get(id)
    if (bucket) bucket.push(row)
    else groups.set(id, [row])
  }
  return [...groups].map(([id, groupRows]) => ({ id, label: id, rows: groupRows }))
}

/** The explorer's row pipeline (filter → aggregate → hidden series). */
function figureRows(dataset: Dataset, spec: ChartSpec): DataRow[] | null {
  if (!spec.x || !spec.y) return null
  return visibleRows(preparedRows(dataset, spec), spec)
}

/** Core builder over pre-pipelined rows, shared by `buildFigure` and the group. */
function buildFigureFromRows(rows: DataRow[], spec: ChartSpec, options: FigureOptions): FigureModel | null {
  const xField = spec.x
  const yField = spec.y
  if (!xField || !yField) return null

  const width = options.width ?? FIGURE_LAYOUT.width
  const height = options.height ?? FIGURE_LAYOUT.height
  const padding = { ...FIGURE_LAYOUT.padding, ...options.padding }
  const plot: FigureBox = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom),
  }

  const xDomain = options.sharedX?.domain ?? figureDomain(spec.xMin, spec.xMax, fieldExtent(rows, xField))
  const yDomain = figureDomain(spec.yMin, spec.yMax, fieldExtent(rows, yField))

  const xScale = scaleFor(spec.xScale)(xDomain, [plot.x, plot.x + plot.width])
  const yScale = scaleFor(spec.yScale)(yDomain, [plot.y + plot.height, plot.y])

  const xTickValues = options.sharedX?.ticks.map((tick) => tick.value) ?? niceTicks(xDomain)
  const yTickValues = niceTicks(yDomain)
  const x: FigureAxis = {
    title: axisTitle(spec.xLabel, spec.xUnit, xField),
    domain: xDomain,
    ticks: xTickValues.map((value) => ({
      value,
      px: xScale(value),
      py: plot.y + plot.height + FIGURE_LAYOUT.tickOffset,
      label: formatValue(value),
    })),
  }
  const y: FigureAxis = {
    title: axisTitle(spec.yLabel, spec.yUnit, yField),
    domain: yDomain,
    ticks: yTickValues.map((value) => ({
      value,
      px: plot.x - FIGURE_LAYOUT.tickGap,
      py: yScale(value),
      label: formatValue(value),
    })),
  }

  // The origin tick sits on the axis line; every other tick gets a gridline.
  const origin = yDomain[0]
  const gridlines = yTickValues.filter((value) => Math.abs(value - origin) > 1e-9).map((value) => yScale(value))

  const seriesField = spec.group ?? spec.color
  const series: FigureSeries[] = seriesRows(rows, seriesField).map((group, index) => {
    const style = seriesStyle(index)
    // Contiguous runs of plotted positions (a missing measure breaks the line),
    // in unclamped data pixels so an off-scale segment clips at the plot edge.
    const runs: Array<Array<{ px: number; py: number }>> = []
    let run: Array<{ px: number; py: number }> = []
    const points: FigurePoint[] = group.rows.map((row, pointIndex) => {
      const valueX = Number(row[xField])
      const rawY = Number(row[yField])
      const valueY = Number.isFinite(rawY) ? rawY : undefined
      const flag = spec.excludeField ? row[spec.excludeField] : undefined
      const excluded = flag === true || flag === 1 || flag === 'true' || flag === 'yes' || flag === 'excluded' || flag === 'flagged'
      const inside = valueY !== undefined && valueY >= yDomain[0] && valueY <= yDomain[1]
      const offScale = valueY !== undefined && !inside
      const px = xScale(valueX)
      const py = inside ? yScale(valueY as number) : plot.y - FIGURE_LAYOUT.offScaleGap
      if (valueY === undefined) {
        if (run.length) runs.push(run)
        run = []
      } else {
        run.push({ px, py: yScale(valueY) })
      }
      const point: FigurePoint = {
        ...(Number.isFinite(Number(row[ROW_ID])) ? { rowId: Number(row[ROW_ID]) } : {}),
        valueX,
        ...(valueY === undefined ? {} : { valueY }),
        px,
        py,
        excluded,
        ...(offScale ? { offScale: true } : {}),
        index: pointIndex,
      }
      if (excluded) {
        if (offScale) {
          const below = (valueY as number) < yDomain[0]
          point.label = `${below ? '↓' : '↑'} ${formatValue(valueY as number)}`
          point.labelX = px + FIGURE_LAYOUT.offScaleLabelDx
          point.labelY = plot.y - FIGURE_LAYOUT.offScaleGap + FIGURE_LAYOUT.offScaleLabelDy
        } else if (spec.excludedLabel) {
          point.label = spec.excludedLabel
          point.labelX = px + FIGURE_LAYOUT.excludedLabelDx
          point.labelY = (py as number) + FIGURE_LAYOUT.excludedLabelDy
        }
      }
      return point
    })
    if (run.length) runs.push(run)
    // A scatter figure plots points only; a line/area figure connects them.
    const line = spec.kind === 'scatter' ? [] : runs.flatMap((positions) => clipPolyline(positions, plot))
    return {
      id: group.id,
      label: group.label || axisTitle(spec.yLabel, spec.yUnit, yField),
      style,
      points,
      line,
      markers: spec.showPoints,
    }
  })

  const refLines: FigureReferenceLine[] = []
  for (const line of spec.refLines ?? []) {
    const text = referenceText(line.label, line.value, line.unit)
    if (line.axis === 'x') {
      const px = xScale(line.value)
      refLines.push({
        id: line.id, axis: 'x', value: line.value, text,
        x1: px, y1: plot.y, x2: px, y2: plot.y + plot.height,
        labelX: px, labelY: plot.y + FIGURE_LAYOUT.fontSize,
      })
    } else {
      const py = yScale(line.value)
      refLines.push({
        id: line.id, axis: 'y', value: line.value, text,
        x1: plot.x, y1: py, x2: plot.x + plot.width, y2: py,
        labelX: plot.x + plot.width - FIGURE_LAYOUT.refLabelInset,
        labelY: py + FIGURE_LAYOUT.refLabelDy,
      })
    }
  }

  const legend = seriesField ? series.map((entry) => ({ label: entry.label, style: entry.style })) : []
  return {
    width,
    height,
    plot,
    x,
    y,
    gridlines,
    series,
    refLines,
    legend,
    xTitle: options.showXAxisTitle === false ? '' : x.title,
    yTitle: options.showYAxisTitle === false ? '' : y.title,
    ariaLabel: describeFigure(spec, rows.length, legend.map((item) => item.label)),
  }
}

export function buildFigure(dataset: Dataset, spec: ChartSpec, options: FigureOptions = {}): FigureModel | null {
  const rows = figureRows(dataset, spec)
  return rows ? buildFigureFromRows(rows, spec, options) : null
}

/** One entry in a shared-x chart stack — the Analysis screen's two figures. */
export interface FigureStackEntry {
  spec: ChartSpec
  height?: number
  /** Draw this entry's x axis title (the stack shows it on the last chart only). */
  showXAxisTitle?: boolean
  showYAxisTitle?: boolean
}

export interface FigureGroup {
  /** Domain and ticks every figure in the stack shares. */
  sharedX: { title: string; domain: readonly [number, number]; ticks: number[] }
  figures: FigureModel[]
}

/**
 * Build a stack of figures that share one x axis. The union of every entry's x
 * domain becomes the shared domain, so a load of 100 sits at the same x in
 * every chart — the Analysis screen's two charts line up vertically.
 */
export function buildFigureGroup(
  dataset: Dataset,
  entries: FigureStackEntry[],
  options: Omit<FigureOptions, 'sharedX'> = {},
): FigureGroup | null {
  if (!entries.length) return null
  const scoped = entries.map((entry) => ({ entry, rows: figureRows(dataset, entry.spec) }))
  if (scoped.some(({ rows }) => rows === null)) return null

  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const { entry, rows } of scoped) {
    const spec = entry.spec
    const xField = spec.x
    if (!xField) return null
    const domain = figureDomain(spec.xMin, spec.xMax, fieldExtent(rows as DataRow[], xField))
    lo = Math.min(lo, domain[0])
    hi = Math.max(hi, domain[1])
  }
  const domain: readonly [number, number] = [lo, hi]
  const ticks = niceTicks(domain)
  const sharedX = { title: '', domain, ticks }
  const figures = scoped.map(({ entry, rows }) => buildFigureFromRows(rows as DataRow[], entry.spec, {
    ...options,
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.showXAxisTitle === undefined ? {} : { showXAxisTitle: entry.showXAxisTitle }),
    ...(entry.showYAxisTitle === undefined ? {} : { showYAxisTitle: entry.showYAxisTitle }),
    sharedX: {
      domain,
      ticks: ticks.map((value) => ({ value, px: 0, py: 0, label: formatValue(value) })),
    },
  }))
  if (figures.some((figure) => figure === null)) return null
  const built = figures as FigureModel[]
  return { sharedX: { ...sharedX, title: built[0]?.x.title ?? '' }, figures: built }
}

/** Screen-reader description, in the shape of the design's figure captions. */
export function describeFigure(spec: ChartSpec, rowCount: number, seriesLabels: string[]): string {
  const kind = `${spec.kind.slice(0, 1).toUpperCase()}${spec.kind.slice(1)} chart`
  const xTitle = spec.x ? axisTitle(spec.xLabel, spec.xUnit, spec.x) : ''
  const yTitle = spec.y ? axisTitle(spec.yLabel, spec.yUnit, spec.y) : ''
  const mapping = xTitle && yTitle ? ` of ${yTitle} against ${xTitle}` : ''
  const parts = [`${kind}${mapping}`]
  if (seriesLabels.length) parts.push(`for ${seriesLabels.join(', ')}`)
  if (spec.refLines?.length) {
    parts.push(`with ${spec.refLines.map((line) => referenceText(line.label, line.value, line.unit)).join(' and ')}`)
  }
  parts.push(`${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`)
  return parts.join(', ')
}
