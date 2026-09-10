import type { FilterOperator } from 'sheetbase-shared'

export type { FilterOperator }

export type DataRow = Record<string, unknown>
export type ColumnKind = 'number' | 'string' | 'boolean' | 'date'

export interface ColumnMeta {
  key: string
  kind: ColumnKind
  nullable: boolean
  uniqueCount: number
}

export interface Dataset {
  name: string
  rows: DataRow[]
  columns: ColumnMeta[]
  source: string
}

export type ChartKind = 'scatter' | 'line' | 'bar' | 'horizontal-bar' | 'area' | 'histogram' | 'box'
export type AggregateKind = 'none' | 'mean' | 'median' | 'sum' | 'count' | 'min' | 'max'
export type BarLayout = 'grouped' | 'stacked' | 'normalized'
export type ErrorMode = 'none' | 'explicit' | 'sd' | 'sem' | 'ci95'
export type FilterLogic = 'and' | 'or'
export type PaletteKind = 'sheetbase' | 'muted' | 'warm' | 'cool' | 'mono' | 'custom'
/** Axis mapping: auto uses linear for numeric fields. */
export type ScaleKind = 'auto' | 'linear' | 'log'
/** Colour mapping: auto uses a gradient for numeric fields, categories otherwise. */
export type ColorScaleKind = 'auto' | 'categorical' | 'continuous'

export interface FilterRule {
  id: string
  field: string
  operator: FilterOperator
  value?: string
  value2?: string
  values?: string[]
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
  palette: string[]
  markColor?: string
  primaryColor?: string
  paletteKind?: PaletteKind
  hiddenSeries?: string[]
  /** Axis mapping. 'auto' (or unset) uses linear for numeric fields. */
  xScale?: ScaleKind
  yScale?: ScaleKind
  /** Colour mapping: 'auto' gradients numeric colour fields, categories otherwise. */
  colorScale?: ColorScaleKind
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
