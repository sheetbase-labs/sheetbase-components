import type { FilterOperator, GroupNode, SummaryKind } from '@sheetbase-labs/sheetbase-shared'

export type { FilterOperator }

export type DataRow = Record<string, unknown>
export type ColumnKind = 'number' | 'string' | 'boolean' | 'date'

export interface ColumnMeta {
  key: string
  kind: ColumnKind
  nullable: boolean
  uniqueCount: number
}

/** A group-by/aggregate query against a dataset whose rows live server-side. */
export interface AggregateQuery {
  /** Filter tree (plan-008 semantics); authoritative over any flat list. */
  filter?: GroupNode
  /** Field whose distinct values become the buckets — the chart's x channel. */
  groupBy: string
  /**
   * Additional statistical dimensions (spec.group/color/facet, deduped,
   * excluding groupBy). Buckets key on (groupBy × seriesBy); each bucket
   * reports its series values in `series`. Servers that ignore it return
   * single-dimension buckets and the client degrades to flat rendering.
   */
  seriesBy?: string[]
  summary: Exclude<SummaryKind, 'none'>
  /** Measure field; required for every summary except `count`. */
  valueField?: string
  limit?: number
}

export interface AggregateBucket {
  key: string
  /** Values for each `seriesBy` field, in request order. */
  series?: Record<string, string>
  count: number
  value: number | null
}

export interface AggregateResponse {
  buckets: AggregateBucket[]
  /** Rows that matched the filter before bucketing. */
  totalRows: number
  revision?: string
}

/** A page of raw rows from a remote dataset — the Data-tab preview. */
export interface RemotePageQuery {
  offset: number
  limit: number
  fields: string[]
  /** Same tree the aggregate takes; authoritative over any flat list. */
  filter?: GroupNode
}

export interface RemotePage {
  rows: DataRow[]
  totalRows: number
  revision?: string
}

/** A random sample of raw rows — what raw-row charts draw on a remote dataset. */
export interface RemoteSampleQuery {
  fields: string[]
  n: number
  /** Same tree the aggregate takes; authoritative over any flat list. */
  filter?: GroupNode
}

export interface RemoteSample {
  rows: DataRow[]
  /** Rows matching the filter. */
  totalRows: number
  /** False when every matching row fit in the sample. */
  sampled: boolean
}

/** Exact server-side histogram bins (shared edges across series). */
export interface RemoteHistogramQuery {
  field: string
  bins: number
  binWidth?: number
  /** Series field: one count array per value, all on the same edges. */
  by?: string
  filter?: GroupNode
}

export interface RemoteHistogram {
  edges: number[]
  series: { key: string | null; counts: number[] }[]
  totalRows: number
  nulls: number
}

/** Capability a remote dataset exposes: server-side group+aggregate. */
export interface RemoteDatasetSource {
  aggregate(query: AggregateQuery, signal?: AbortSignal): Promise<AggregateResponse>
  /**
   * Optional raw-row fetch — when present the Data tab shows a first-page
   * preview instead of the remote note. The chart never needs it.
   */
  page?(query: RemotePageQuery, signal?: AbortSignal): Promise<RemotePage>
  /**
   * Optional random sample — when present, raw-row charts (scatter without
   * an aggregate, box, violin, heatmap) draw the sample with a "sampled"
   * note instead of asking for an aggregate.
   */
  sample?(query: RemoteSampleQuery, signal?: AbortSignal): Promise<RemoteSample>
  /** Optional exact bins — histograms then cover every matching row. */
  histogram?(query: RemoteHistogramQuery, signal?: AbortSignal): Promise<RemoteHistogram>
}

export interface Dataset {
  name: string
  rows: DataRow[]
  columns: ColumnMeta[]
  source: string
  /**
   * Set when the dataset's rows live server-side: `rows` stays empty and
   * aggregated chart data is fetched through this capability instead of
   * computed in-browser. Row-level features (SQL, export-all) don't apply;
   * the data table shows a preview when `remote.page` is provided.
   */
  remote?: RemoteDatasetSource
}

export type ChartKind = 'scatter' | 'line' | 'bar' | 'horizontal-bar' | 'area' | 'histogram' | 'box' | 'lollipop' | 'violin' | 'waterfall' | 'heatmap' | 'pie' | 'donut'
export type AggregateKind = 'none' | 'mean' | 'median' | 'sum' | 'count' | 'min' | 'max'
export type BarLayout = 'grouped' | 'stacked' | 'normalized'
export type ErrorMode = 'none' | 'explicit' | 'sd' | 'sem' | 'ci95'
export type FilterLogic = 'and' | 'or'
export type PaletteKind = 'sheetbase' | 'muted' | 'warm' | 'cool' | 'mono' | 'custom'
/** Axis mapping: auto uses linear for numeric fields. */
export type ScaleKind = 'auto' | 'linear' | 'log' | 'sqrt' | 'symlog'
/** Colour mapping: auto uses a gradient for numeric fields, categories otherwise. */
export type ColorScaleKind = 'auto' | 'categorical' | 'continuous'
/** Line/area interpolation. */
export type LineCurveKind = 'auto' | 'smooth' | 'step' | 'monotone'

export interface ReferenceLine {
  id: string
  axis: 'x' | 'y'
  value: number
  label?: string
  /** Unit appended to the reference label ("Target ≥ 80 %"). */
  unit?: string
}

export interface FilterRule {
  id: string
  field: string
  operator: FilterOperator
  value?: string
  value2?: string
  values?: string[]
}

/**
 * Per-figure sizing overrides, in figure (viewBox) units, for a host that
 * authors a design screen at a different scale than the canonical 844×262
 * figure (the ELN's Analysis canvas sizes its text, markers and strokes for a
 * 0.758 display scale). Every field defaults to the canonical design value, so
 * omitting `metrics` leaves the figure unchanged.
 */
export interface FigureMetrics {
  /** Text size for tick labels, axis titles and the legend. Default 11. */
  fontSize?: number
  /** Text size for data labels (excluded/off-scale, bar and heat). Defaults to `fontSize`. */
  labelFontSize?: number
  /** Marker radius / half-size for points and hollow excluded markers. Default 4. */
  markerSize?: number
  /** Stroke width for series lines. Default 1.6. */
  lineWidth?: number
  /** Stroke width for marker outlines and box/violin strokes. Default 1.4. */
  strokeWidth?: number
  /** Stroke width for dashed reference lines. Default 1. */
  refStrokeWidth?: number
}

export interface ChartSpec {
  kind: ChartKind
  x?: string
  y?: string
  group?: string
  color?: string
  facet?: string
  errorMode?: ErrorMode
  errorLow?: string
  errorHigh?: string
  filters?: FilterRule[]
  filterLogic?: FilterLogic
  aggregate: AggregateKind
  xLabel?: string
  yLabel?: string
  /** Units appended to the axis titles ("Load (L/m²)"); v3 figures draw them. */
  xUnit?: string
  yUnit?: string
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  zoomX?: { start: number; end: number }
  zoomEnabled?: boolean
  showPoints: boolean
  showRawPoints?: boolean
  showRibbon?: boolean
  showRegression?: boolean
  showGrid: boolean
  pointSize: number
  pointOpacity: number
  lineWidth: number
  lineOpacity: number
  fillOpacity: number
  barGap: number
  barRadius: number
  barLayout: BarLayout
  histogramBins: number
  /** Histogram: explicit bin width over the observed range; wins over `histogramBins`. */
  histogramBinWidth?: number
  /** Histogram: plot a probability density rather than counts. */
  histogramDensity?: boolean
  /** Violin: KDE bandwidth in data units; automatic (Silverman) when absent. */
  violinBandwidth?: number
  palette: string[]
  markColor?: string
  primaryColor?: string
  paletteKind?: PaletteKind
  hiddenSeries?: string[]
  /** Axis mapping. 'auto' (or unset) uses linear for numeric fields. */
  xScale?: ScaleKind
  yScale?: ScaleKind
  /** Flip an axis so values increase towards the origin. */
  xReverse?: boolean
  yReverse?: boolean
  /** Colour mapping: 'auto' gradients numeric colour fields, categories otherwise. */
  colorScale?: ColorScaleKind
  /** Size scatter dots by a numeric field. */
  size?: string
  /** Line/area interpolation. */
  lineCurve?: LineCurveKind
  /** Horizontal/vertical guides drawn over the marks. */
  refLines?: ReferenceLine[]
  /**
   * Flag field marking points excluded from the decision (v3): those markers
   * are drawn hollow and, when off-scale, pinned at the plot edge with a label.
   */
  excludeField?: string
  /** Text beside an on-scale excluded marker (design: "flagged"). */
  excludedLabel?: string
  /** Draw a text label at each mark. */
  labels?: boolean
  /** Field shown in data labels (defaults to the y value). */
  labelField?: string
  /** Ordering of categorical x values. */
  categoryOrder?: 'auto' | 'value-asc' | 'value-desc' | 'label-asc'
  /** Second numeric measure, drawn as a line on a right-hand y axis. */
  y2?: string
  /**
   * Standalone-figure sizing overrides (`Chart`/`buildFigure`); omitted, the
   * figure uses the design's canonical metrics.
   */
  metrics?: FigureMetrics
}

export interface SavedExploration {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  spec: ChartSpec
  sql: string
}

export interface DataAdapter {
  id: string
  label: string
  load(): Promise<Dataset>
}
