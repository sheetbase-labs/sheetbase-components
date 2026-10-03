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
import type { ChartKind, ChartSpec, DataRow, Dataset, ScaleKind } from './types'

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

/**
 * Steps in the heatmap's sequential colour scale. The scale is discrete rather
 * than a gradient (the chart rules forbid gradients) and is derived entirely
 * from theme variables, so a host rethemes it by mapping `series-a`/`surface`.
 */
export const HEATMAP_SCALE_STEPS = 5

/** Bucket a normalised value (0–1) onto the scale's discrete steps. */
export function heatmapStep(t: number): number {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  return Math.min(HEATMAP_SCALE_STEPS - 1, Math.round(clamped * (HEATMAP_SCALE_STEPS - 1)))
}

/**
 * The heatmap scale colour for a normalised value: the design's series hue
 * mixed over the plot surface, 20 % → 100 %. Never a literal, so the COMP-01
 * colour lint stays clean.
 */
export function heatmapColour(t: number): string {
  const percent = Math.round(((heatmapStep(t) + 1) / HEATMAP_SCALE_STEPS) * 100)
  return `color-mix(in srgb, var(--series-a) ${percent}%, var(--surface))`
}

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

/** One category band on a categorical axis (bar, box and heatmap). */
export interface FigureBand {
  /** Raw category value, as the field's string form. */
  value: string
  label: string
  /** Left edge, drawable width and centre of the band, in figure units. */
  start: number
  width: number
  px: number
}

export interface FigureAxis {
  /** Design label, already carrying its unit ("Load (L/m²)"). */
  title: string
  domain: readonly [number, number]
  ticks: FigureTick[]
  /**
   * `numeric` (default) or `band` for a categorical axis. A band axis puts one
   * tick per category at the band centre, with the category label.
   */
  kind?: 'numeric' | 'band'
  /** Category bands, present on a band axis. */
  bands?: FigureBand[]
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

/**
 * A bar mark (kind `bar`). A grouped bar sits in its own sub-band; a stacked or
 * normalised segment carries the baseline it rises from in `value0`.
 */
export interface FigureBar {
  rowId?: number
  category: string
  seriesId: string
  /** Theme token for the series, e.g. `var(--series-a)`. */
  colour: string
  /** Pixel rectangle of the bar. */
  x: number
  y: number
  width: number
  height: number
  /** Plotted value (a proportion when the layout is normalised). */
  value: number
  /** Baseline the bar rises from (0 for grouped bars). */
  value0: number
  /** Position in draw order, for a stable React key. */
  index: number
  label?: string
  labelX?: number
  labelY?: number
}

/** A box-plot outlier: a point outside the 1.5×IQR whiskers. */
export interface FigureBoxOutlier {
  rowId?: number
  value: number
  px: number
  py: number
  /** Position among the box's outliers, for a stable React key. */
  index: number
}

/**
 * A box mark (kind `box`): the five-number summary of one category (and series),
 * with Tukey whiskers and the points beyond them.
 */
export interface FigureBoxPlot {
  category: string
  seriesId: string
  colour: string
  /** Left edge, width and centre of the box, in figure units. */
  x: number
  width: number
  px: number
  /** Five-number summary, in data units. */
  min: number
  q1: number
  median: number
  q3: number
  max: number
  /** Whisker ends (equal to min/max when no point falls outside the fences). */
  whiskerLow: number
  whiskerHigh: number
  /** Summary positions, in figure pixels (clamped to the plot rectangle). */
  yMin: number
  yQ1: number
  yMedian: number
  yQ3: number
  yMax: number
  yWhiskerLow: number
  yWhiskerHigh: number
  /** Points beyond the whiskers; drawn only when `showOutliers`. */
  outliers: FigureBoxOutlier[]
  /** From `spec.showPoints` — the design's spread is opt-in. */
  showOutliers: boolean
}

/** A heatmap cell (kind `heatmap`): one aggregated value on the category grid. */
export interface FigureHeatCell {
  x: string
  y: string
  value: number
  rect: FigureBox
  /** Theme-derived step of the sequential scale. */
  colour: string
  label?: string
  labelX?: number
  labelY?: number
}

/** One discrete step of a colour scale legend. */
export interface FigureScaleStep {
  colour: string
  /** Inclusive lower bound, in data units. */
  from: number
  /** Exclusive upper bound (inclusive for the last step). */
  to: number
  label: string
}

/** Legend for a continuous colour scale (heatmap). */
export interface FigureScaleLegend {
  label: string
  min: number
  max: number
  /** Nice tick values between min and max. */
  ticks: number[]
  steps: FigureScaleStep[]
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
  /** Bar marks; empty unless `kind` is `bar`. */
  bars?: FigureBar[]
  /** Box marks; empty unless `kind` is `box`. */
  boxes?: FigureBoxPlot[]
  /** Heatmap cells; empty unless `kind` is `heatmap`. */
  heat?: FigureHeatCell[]
  /** Discrete colour-scale legend for a heatmap. */
  scaleLegend?: FigureScaleLegend
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

// ---------------------------------------------------------------------------
// Bar, box and heatmap marks (COMP-03 extras)
//
// `bar`, `box` and `heatmap` read categories from their fields instead of a
// numeric scale, so they get their own builders. They reuse the same frame,
// axis, tick, gridline, reference-line and legend machinery as the line figure.
// ---------------------------------------------------------------------------

/** Figure geometry from the options, shared by every kind. */
function figureFrame(options: FigureOptions) {
  const width = options.width ?? FIGURE_LAYOUT.width
  const height = options.height ?? FIGURE_LAYOUT.height
  const padding = { ...FIGURE_LAYOUT.padding, ...options.padding }
  const plot: FigureBox = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom),
  }
  return { width, height, plot }
}

export interface FigureBandScale {
  count: number
  /** Distance between band starts. */
  step: number
  /** Drawable width of one band. */
  width: number
  /** Left edge and centre of band `index`. */
  start: (index: number) => number
  centre: (index: number) => number
}

/** A d3-style band scale over `count` categories, padded like the design's bars. */
export function bandScale(count: number, range: readonly [number, number], padding = 0.18): FigureBandScale {
  const [r0, r1] = range
  const n = Math.max(1, count)
  const step = (r1 - r0) / n
  const width = Math.max(0, step * (1 - padding))
  const offset = (step - width) / 2
  return {
    count: n,
    step,
    width,
    start: (index) => r0 + step * index + offset,
    centre: (index) => r0 + step * (index + 0.5),
  }
}

/** One slot inside a band for grouped bars or boxes, separated by a pixel gap. */
function slotFor(band: FigureBandScale, index: number, slot: number, slots: number, gap: number): { x: number; width: number } {
  const count = Math.max(1, slots)
  const inner = Math.max(0, gap)
  const width = Math.max(0, (band.width - inner * (count - 1)) / count)
  return { x: band.start(index) + slot * (width + inner), width }
}

/** Distinct category values, in first-seen order or ranked by `categoryOrder`. */
function orderedCategories(
  rows: DataRow[],
  field: string,
  order: ChartSpec['categoryOrder'],
  yField: string | undefined,
): string[] {
  const totals = new Map<string, number>()
  const seen: string[] = []
  for (const row of rows) {
    const key = String(row[field] ?? '')
    if (!key) continue
    if (!totals.has(key)) {
      totals.set(key, 0)
      seen.push(key)
    }
    const value = yField ? Number(row[yField]) : 1
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(value) ? value : 0))
  }
  if (order === 'label-asc') return [...seen].sort((a, b) => a.localeCompare(b))
  if (order === 'value-asc') return [...seen].sort((a, b) => (totals.get(a) ?? 0) - (totals.get(b) ?? 0))
  if (order === 'value-desc') return [...seen].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
  return seen
}

/** Bucket rows by category index, for the builders that draw one mark per cell. */
function bucketByCategory(rows: DataRow[], field: string, index: Map<string, number>): Map<number, DataRow[]> {
  const buckets = new Map<number, DataRow[]>()
  for (const row of rows) {
    const position = index.get(String(row[field] ?? ''))
    if (position === undefined) continue
    const bucket = buckets.get(position)
    if (bucket) bucket.push(row)
    else buckets.set(position, [row])
  }
  return buckets
}

/** A categorical axis: one tick per band centre, carrying the category label. */
function bandAxis(title: string, categories: string[], band: FigureBandScale, plot: FigureBox, axis: 'x' | 'y'): FigureAxis {
  return {
    title,
    domain: [0, categories.length],
    kind: 'band',
    bands: categories.map((value, position) => ({
      value,
      label: value,
      start: band.start(position),
      width: band.width,
      px: band.centre(position),
    })),
    ticks: categories.map((value, position) => ({
      value: position,
      px: axis === 'x' ? band.centre(position) : plot.x - FIGURE_LAYOUT.tickGap,
      py: axis === 'x' ? plot.y + plot.height + FIGURE_LAYOUT.tickOffset : band.centre(position),
      label: value,
    })),
  }
}

/** The numeric y axis, its tick pixels and the gridlines under a mark. */
function numericYAxis(spec: ChartSpec, yField: string, domain: readonly [number, number], plot: FigureBox) {
  const yScale = scaleFor(spec.yScale)(domain, [plot.y + plot.height, plot.y])
  const tickValues = niceTicks(domain)
  const origin = domain[0]
  return {
    yScale,
    axis: {
      title: axisTitle(spec.yLabel, spec.yUnit, yField),
      domain,
      ticks: tickValues.map((value) => ({
        value,
        px: plot.x - FIGURE_LAYOUT.tickGap,
        py: yScale(value),
        label: formatValue(value),
      })),
    } as FigureAxis,
    // The origin tick sits on the axis line; every other tick gets a gridline.
    gridlines: tickValues.filter((value) => Math.abs(value - origin) > 1e-9).map((value) => yScale(value)),
  }
}

/**
 * Reference lines for a mark. A band x axis has no numeric x scale, so only
 * y-axis lines are placed for the categorical kinds.
 */
function markRefLines(spec: ChartSpec, xScale: Scale | undefined, yScale: Scale, plot: FigureBox): FigureReferenceLine[] {
  const refLines: FigureReferenceLine[] = []
  for (const line of spec.refLines ?? []) {
    const text = referenceText(line.label, line.value, line.unit)
    if (line.axis === 'x') {
      if (!xScale) continue
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
  return refLines
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

  if (spec.kind === 'bar') return buildBarFigure(rows, spec, options)
  if (spec.kind === 'box') return buildBoxFigure(rows, spec, options)
  if (spec.kind === 'heatmap') return buildHeatmapFigure(rows, spec, options)

  const { width, height, plot } = figureFrame(options)

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

/**
 * Bar figure (kind `bar`): one bar per prepared row on a categorical x band.
 * `barLayout` groups sibling series side by side, or stacks/normalises them
 * within the band; bars rise from a zero baseline.
 */
function buildBarFigure(rows: DataRow[], spec: ChartSpec, options: FigureOptions): FigureModel | null {
  const xField = spec.x
  const yField = spec.y
  if (!xField || !yField) return null

  const { width, height, plot } = figureFrame(options)
  const seriesField = spec.group ?? spec.color
  const categories = orderedCategories(rows, xField, spec.categoryOrder, yField)
  if (!categories.length) return null

  const index = new Map<string, number>(categories.map((value, position): [string, number] => [value, position]))
  const band = bandScale(categories.length, [plot.x, plot.x + plot.width])
  const layout = spec.barLayout ?? 'grouped'
  const normalized = layout === 'normalized'
  const stacked = normalized || layout === 'stacked'
  const gap = Math.max(0, spec.barGap)

  const seriesGroups = seriesRows(rows, seriesField).map((group) => ({
    ...group,
    byCategory: bucketByCategory(group.rows, xField, index),
  }))
  const drawnGroups = seriesField ? seriesGroups : seriesGroups.slice(0, 1)

  const sumValues = (bucket: DataRow[]) => {
    let positive = 0
    let negative = 0
    for (const row of bucket) {
      const value = Number(row[yField])
      if (!Number.isFinite(value)) continue
      if (value >= 0) positive += value
      else negative += value
    }
    return { positive, negative }
  }

  // Stacked bars and normalised proportions both measure a whole category, so
  // the totals are summed across series once.
  const categoryTotals = categories.map((_, position) => {
    let positive = 0
    let negative = 0
    let found = false
    for (const group of drawnGroups) {
      const bucket = group.byCategory.get(position)
      if (!bucket?.length) continue
      found = true
      const totals = sumValues(bucket)
      positive += totals.positive
      negative += totals.negative
    }
    return { positive, negative, found }
  })

  // Grouped bars measure single values; stacked ones measure category totals.
  let dataLo = 0
  let dataHi = 0
  let found = false
  if (stacked) {
    for (const totals of categoryTotals) {
      if (!totals.found) continue
      found = true
      dataHi = Math.max(dataHi, totals.positive)
      dataLo = Math.min(dataLo, totals.negative)
    }
  } else {
    for (const group of drawnGroups) {
      for (const bucket of group.byCategory.values()) {
        for (const row of bucket) {
          const value = Number(row[yField])
          if (!Number.isFinite(value)) continue
          found = true
          dataHi = Math.max(dataHi, value)
          dataLo = Math.min(dataLo, value)
        }
      }
    }
  }
  const extent: readonly [number, number] = found ? [dataLo, dataHi] : [0, 1]
  const yDomain = normalized ? ([0, 1] as const) : figureDomain(spec.yMin, spec.yMax, extent)
  const { yScale, axis: y, gridlines } = numericYAxis(spec, yField, yDomain, plot)
  const x = bandAxis(axisTitle(spec.xLabel, spec.xUnit, xField), categories, band, plot, 'x')

  const bars: FigureBar[] = []
  const slots = stacked ? 1 : drawnGroups.length
  const stacks = categories.map(() => ({ positive: 0, negative: 0 }))
  for (let seriesIndex = 0; seriesIndex < drawnGroups.length; seriesIndex++) {
    const group = drawnGroups[seriesIndex] as (typeof drawnGroups)[number]
    const style = seriesStyle(seriesField ? seriesIndex : 0)
    const positions = [...group.byCategory.keys()].sort((a, b) => a - b)
    for (const position of positions) {
      const bucket = group.byCategory.get(position) as DataRow[]
      const categoryTotal = categoryTotals[position] as { positive: number; negative: number }
      const denominator = categoryTotal.positive + categoryTotal.negative
      const stack = stacks[position] as { positive: number; negative: number }
      for (const row of bucket) {
        const raw = Number(row[yField])
        if (!Number.isFinite(raw)) continue
        const value = normalized ? (denominator === 0 ? 0 : raw / denominator) : raw
        let value0 = 0
        if (stacked) {
          if (value >= 0) {
            value0 = stack.positive
            stack.positive += value
          } else {
            value0 = stack.negative
            stack.negative += value
          }
        }
        const slot = stacked
          ? { x: band.start(position), width: band.width }
          : slotFor(band, position, seriesIndex, slots, gap)
        const bottom = yScale(value0)
        const top = yScale(value0 + value)
        const bar: FigureBar = {
          ...(Number.isFinite(Number(row[ROW_ID])) ? { rowId: Number(row[ROW_ID]) } : {}),
          category: categories[position] as string,
          seriesId: group.id,
          colour: style.colour,
          x: slot.x,
          y: Math.min(top, bottom),
          width: slot.width,
          height: Math.abs(bottom - top),
          value,
          value0,
          index: bars.length,
        }
        if (spec.labels) {
          const label = spec.labelField ? row[spec.labelField] : undefined
          bar.label = label === undefined || label === null ? formatValue(value) : String(label)
          bar.labelX = slot.x + slot.width / 2
          bar.labelY = Math.min(top, bottom) - FIGURE_LAYOUT.refLabelInset
        }
        bars.push(bar)
      }
    }
  }

  const legend: FigureLegendItem[] = seriesField
    ? seriesGroups.map((group, position) => ({ label: group.label || yField, style: seriesStyle(position) }))
    : []
  return {
    width,
    height,
    plot,
    x,
    y,
    gridlines,
    series: [],
    refLines: markRefLines(spec, undefined, yScale, plot),
    legend,
    bars,
    xTitle: options.showXAxisTitle === false ? '' : x.title,
    yTitle: options.showYAxisTitle === false ? '' : y.title,
    ariaLabel: describeFigure(spec, rows.length, legend.map((item) => item.label)),
  }
}

/** The five-number summary and Tukey whisker ends of one box. */
export interface FigureBoxSummary {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  whiskerLow: number
  whiskerHigh: number
}

/** Quantile with linear interpolation between ranks (the usual type-7 rule). */
function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN
  const position = (sorted.length - 1) * p
  const base = Math.floor(position)
  const rest = position - base
  const lower = sorted[base] as number
  const upper = sorted[Math.min(sorted.length - 1, base + 1)] as number
  return lower + rest * (upper - lower)
}

/**
 * Five-number summary with Tukey whiskers: the whiskers reach the most extreme
 * points still inside 1.5×IQR of the quartiles, and everything beyond them is
 * an outlier (drawn as a point by the renderer).
 */
export function boxSummary(values: number[]): FigureBoxSummary {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) {
    return { min: Number.NaN, q1: Number.NaN, median: Number.NaN, q3: Number.NaN, max: Number.NaN, whiskerLow: Number.NaN, whiskerHigh: Number.NaN }
  }
  const q1 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const fence = 1.5 * (q3 - q1)
  const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence)
  return {
    min: sorted[0] as number,
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1] as number,
    whiskerLow: inside.length ? (inside[0] as number) : q1,
    whiskerHigh: inside.length ? (inside[inside.length - 1] as number) : q3,
  }
}

/**
 * Box figure (kind `box`): the five-number summary of `y` per categorical `x`
 * (and series), with the points beyond the whiskers kept as outliers. The
 * design's spread display is opt-in through `spec.showPoints`.
 */
function buildBoxFigure(rows: DataRow[], spec: ChartSpec, options: FigureOptions): FigureModel | null {
  const xField = spec.x
  const yField = spec.y
  if (!xField || !yField) return null

  const { width, height, plot } = figureFrame(options)
  const seriesField = spec.group ?? spec.color
  const categories = orderedCategories(rows, xField, spec.categoryOrder, yField)
  if (!categories.length) return null

  const index = new Map<string, number>(categories.map((value, position): [string, number] => [value, position]))
  const band = bandScale(categories.length, [plot.x, plot.x + plot.width])
  const yDomain = figureDomain(spec.yMin, spec.yMax, fieldExtent(rows, yField))
  const { yScale, axis: y, gridlines } = numericYAxis(spec, yField, yDomain, plot)
  const x = bandAxis(axisTitle(spec.xLabel, spec.xUnit, xField), categories, band, plot, 'x')

  const seriesGroups = seriesRows(rows, seriesField).map((group) => ({
    ...group,
    byCategory: bucketByCategory(group.rows, xField, index),
  }))
  const drawnGroups = seriesField ? seriesGroups : seriesGroups.slice(0, 1)
  const slots = drawnGroups.length
  const gap = Math.max(0, spec.barGap) + FIGURE_LAYOUT.strokeWidth
  const low = plot.y
  const high = plot.y + plot.height
  const boxes: FigureBoxPlot[] = []
  for (let seriesIndex = 0; seriesIndex < drawnGroups.length; seriesIndex++) {
    const group = drawnGroups[seriesIndex] as (typeof drawnGroups)[number]
    const style = seriesStyle(seriesField ? seriesIndex : 0)
    const positions = [...group.byCategory.keys()].sort((a, b) => a - b)
    for (const position of positions) {
      const bucket = group.byCategory.get(position) as DataRow[]
      const pairs = bucket
        .map((row) => ({ row, value: Number(row[yField]) }))
        .filter((pair) => Number.isFinite(pair.value))
      if (!pairs.length) continue
      const summary = boxSummary(pairs.map((pair) => pair.value))
      const slot = slotFor(band, position, seriesIndex, slots, gap)
      const px = slot.x + slot.width / 2
      // A tighter explicit y range clamps the summary to the plot rectangle.
      const yOf = (value: number) => Math.min(high, Math.max(low, yScale(value)))
      const fence = 1.5 * (summary.q3 - summary.q1)
      const outliers: FigureBoxOutlier[] = pairs
        .filter((pair) => pair.value < summary.q1 - fence || pair.value > summary.q3 + fence)
        .map((pair, outlierIndex) => ({
          ...(Number.isFinite(Number(pair.row[ROW_ID])) ? { rowId: Number(pair.row[ROW_ID]) } : {}),
          value: pair.value,
          px,
          py: yOf(pair.value),
          index: outlierIndex,
        }))
      boxes.push({
        category: categories[position] as string,
        seriesId: group.id,
        colour: style.colour,
        x: slot.x,
        width: slot.width,
        px,
        min: summary.min,
        q1: summary.q1,
        median: summary.median,
        q3: summary.q3,
        max: summary.max,
        whiskerLow: summary.whiskerLow,
        whiskerHigh: summary.whiskerHigh,
        yMin: yOf(summary.min),
        yQ1: yOf(summary.q1),
        yMedian: yOf(summary.median),
        yQ3: yOf(summary.q3),
        yMax: yOf(summary.max),
        yWhiskerLow: yOf(summary.whiskerLow),
        yWhiskerHigh: yOf(summary.whiskerHigh),
        outliers,
        showOutliers: spec.showPoints,
      })
    }
  }

  const legend: FigureLegendItem[] = seriesField
    ? seriesGroups.map((group, position) => ({ label: group.label || yField, style: seriesStyle(position) }))
    : []
  return {
    width,
    height,
    plot,
    x,
    y,
    gridlines,
    series: [],
    refLines: markRefLines(spec, undefined, yScale, plot),
    legend,
    boxes,
    xTitle: options.showXAxisTitle === false ? '' : x.title,
    yTitle: options.showYAxisTitle === false ? '' : y.title,
    ariaLabel: describeFigure(spec, rows.length, legend.map((item) => item.label)),
  }
}

/** One aggregated heatmap bucket before it becomes a cell. */
interface HeatmapBucket {
  x: string
  y: string
  sum: number
  count: number
  min: number
  max: number
}

/**
 * Heatmap figure (kind `heatmap`): the x and y fields are categories and the
 * cell value is `spec.size` aggregated per cell (`spec.aggregate`, default
 * sum) or the row count without one. The colour is the discrete, themed
 * sequential scale above.
 */
function buildHeatmapFigure(rows: DataRow[], spec: ChartSpec, options: FigureOptions): FigureModel | null {
  const xField = spec.x
  const yField = spec.y
  if (!xField || !yField) return null

  const { width, height, plot } = figureFrame(options)
  const xCategories = orderedCategories(rows, xField, spec.categoryOrder, spec.size)
  const yCategories = orderedCategories(rows, yField, undefined, spec.size)
  if (!xCategories.length || !yCategories.length) return null

  const buckets = new Map<string, HeatmapBucket>()
  for (const row of rows) {
    const x = String(row[xField] ?? '')
    const y = String(row[yField] ?? '')
    if (!x || !y) continue
    const value = spec.size ? Number(row[spec.size]) : 1
    if (!Number.isFinite(value)) continue
    const key = `${x}\u0000${y}`
    const bucket = buckets.get(key) ?? { x, y, sum: 0, count: 0, min: value, max: value }
    bucket.sum += value
    bucket.count += 1
    bucket.min = Math.min(bucket.min, value)
    bucket.max = Math.max(bucket.max, value)
    buckets.set(key, bucket)
  }
  if (!buckets.size) return null

  const mode = !spec.size
    ? 'count'
    : spec.aggregate === 'mean'
      ? 'mean'
      : spec.aggregate === 'min'
        ? 'min'
        : spec.aggregate === 'max'
          ? 'max'
          : spec.aggregate === 'count'
            ? 'count'
            : 'sum'
  const cells: Array<{ bucket: HeatmapBucket; value: number }> = []
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const bucket of buckets.values()) {
    const value = mode === 'count'
      ? bucket.count
      : mode === 'mean'
        ? bucket.sum / bucket.count
        : mode === 'min'
          ? bucket.min
          : mode === 'max'
            ? bucket.max
            : bucket.sum
    if (value < min) min = value
    if (value > max) max = value
    cells.push({ bucket, value })
  }
  const span = max - min

  const xBand = bandScale(xCategories.length, [plot.x, plot.x + plot.width], 0.05)
  const yBand = bandScale(yCategories.length, [plot.y, plot.y + plot.height], 0.05)
  const xIndex = new Map<string, number>(xCategories.map((value, position): [string, number] => [value, position]))
  const yIndex = new Map<string, number>(yCategories.map((value, position): [string, number] => [value, position]))
  const heat: FigureHeatCell[] = cells.map(({ bucket, value }) => {
    const rect: FigureBox = {
      x: xBand.start(xIndex.get(bucket.x) as number),
      y: yBand.start(yIndex.get(bucket.y) as number),
      width: xBand.width,
      height: yBand.width,
    }
    const cell: FigureHeatCell = {
      x: bucket.x,
      y: bucket.y,
      value,
      rect,
      colour: heatmapColour(span === 0 ? 0.5 : (value - min) / span),
    }
    if (spec.labels) {
      cell.label = formatValue(value)
      cell.labelX = rect.x + rect.width / 2
      cell.labelY = rect.y + rect.height / 2 + FIGURE_LAYOUT.yTickBaseline
    }
    return cell
  })

  const x = bandAxis(axisTitle(spec.xLabel, spec.xUnit, xField), xCategories, xBand, plot, 'x')
  const y = bandAxis(axisTitle(spec.yLabel, spec.yUnit, yField), yCategories, yBand, plot, 'y')
  const scaleLegend: FigureScaleLegend = {
    label: spec.size ?? 'count',
    min,
    max,
    ticks: niceTicks([min, max]),
    steps: Array.from({ length: HEATMAP_SCALE_STEPS }, (_, step) => {
      const from = min + (span === 0 ? 0 : ((step - 0.5) / (HEATMAP_SCALE_STEPS - 1)) * span)
      const to = min + (span === 0 ? 0 : ((step + 0.5) / (HEATMAP_SCALE_STEPS - 1)) * span)
      const low = Math.max(min, from)
      const high = Math.min(max, to)
      return {
        colour: heatmapColour(step / (HEATMAP_SCALE_STEPS - 1)),
        from: low,
        to: high,
        label: `${formatValue(low)}–${formatValue(high)}`,
      }
    }),
  }

  return {
    width,
    height,
    plot,
    x,
    y,
    gridlines: [],
    series: [],
    refLines: [],
    legend: [],
    heat,
    scaleLegend,
    xTitle: options.showXAxisTitle === false ? '' : x.title,
    yTitle: options.showYAxisTitle === false ? '' : y.title,
    ariaLabel: describeFigure(spec, rows.length, []),
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
 * every chart — the Analysis screen's two charts line up vertically. The
 * categorical kinds (bar, box, heatmap) have no shared numeric axis, so a stack
 * containing one builds nothing.
 */
export function buildFigureGroup(
  dataset: Dataset,
  entries: FigureStackEntry[],
  options: Omit<FigureOptions, 'sharedX'> = {},
): FigureGroup | null {
  if (entries.some((entry) => entry.spec.kind === 'bar' || entry.spec.kind === 'box' || entry.spec.kind === 'heatmap')) return null
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

/** Figure kinds whose chart noun differs from "`Kind` chart". */
const FIGURE_KIND_LABELS: Partial<Record<ChartKind, string>> = {
  box: 'Box plot',
  heatmap: 'Heatmap',
  violin: 'Violin plot',
}

/** Screen-reader description, in the shape of the design's figure captions. */
export function describeFigure(spec: ChartSpec, rowCount: number, seriesLabels: string[]): string {
  const kind = FIGURE_KIND_LABELS[spec.kind] ?? `${spec.kind.slice(0, 1).toUpperCase()}${spec.kind.slice(1)} chart`
  const xTitle = spec.x ? axisTitle(spec.xLabel, spec.xUnit, spec.x) : ''
  const yTitle = spec.y ? axisTitle(spec.yLabel, spec.yUnit, spec.y) : ''
  // A heatmap's two fields are both dimensions; its measure is the size field
  // (or the cell count).
  const mapping = spec.kind === 'heatmap' && xTitle && yTitle
    ? ` of ${spec.size ?? 'count'} by ${xTitle} and ${yTitle}`
    : xTitle && yTitle
      ? ` of ${yTitle} against ${xTitle}`
      : ''
  const parts = [`${kind}${mapping}`]
  if (seriesLabels.length) parts.push(`for ${seriesLabels.join(', ')}`)
  if (spec.refLines?.length) {
    parts.push(`with ${spec.refLines.map((line) => referenceText(line.label, line.value, line.unit)).join(' and ')}`)
  }
  parts.push(`${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`)
  return parts.join(', ')
}
