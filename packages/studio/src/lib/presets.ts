import type { AnalysisView, FieldProfile, SheetbaseField, SummaryKind } from '@sheetbase-labs/sheetbase-shared'
import type { ChartKind, ChartSpec } from '@sheetbase-labs/sheetbase-explorer'

/** Few enough distinct values to treat a field as categories. */
export const CATEGORY_LIMIT = 12

export type FieldRole = 'x' | 'y' | 'color'

const CLEARED: Partial<ChartSpec> = {
  group: undefined, color: undefined, facet: undefined, size: undefined,
  errorMode: 'none', errorLow: undefined, errorHigh: undefined,
  xLabel: undefined, yLabel: undefined, xUnit: undefined, yUnit: undefined,
  xMin: undefined, xMax: undefined, yMin: undefined, yMax: undefined,
  zoomX: undefined, hiddenSeries: [], filters: [], filterLogic: 'and',
  refLines: [], y2: undefined, labels: false, categoryOrder: 'auto',
}

export function isCategorical(field: SheetbaseField, profile?: FieldProfile): boolean {
  if (field.dataType === 'boolean' || field.dataType === 'text' || field.dataType === 'relationship') return true
  return field.dataType === 'number' && profile?.distinct !== null && profile?.distinct !== undefined && profile.distinct <= CATEGORY_LIMIT
}

/**
 * "Chart this field" — the chart a scientist would draw first to see what a
 * column holds: a histogram for a measurement, counts for categories, a count
 * over time for dates.
 */
export function chartForField(field: SheetbaseField, profile: FieldProfile | undefined, spec: ChartSpec, view: AnalysisView): { spec: ChartSpec; view: AnalysisView } {
  const base = { ...spec, ...CLEARED, x: field.id }
  if (field.dataType === 'date' || field.dataType === 'datetime') {
    return { spec: { ...base, kind: 'line', y: undefined, showPoints: true, xLabel: field.label }, view: { ...view, summary: 'count', groupBy: undefined } }
  }
  if (field.dataType === 'number' && !isCategorical(field, profile)) {
    return { spec: { ...base, kind: 'histogram', y: undefined, xLabel: field.label, yLabel: 'Rows' }, view: { ...view, summary: 'none', groupBy: undefined } }
  }
  const many = (profile?.distinct ?? 0) > CATEGORY_LIMIT
  return {
    spec: { ...base, kind: many ? 'horizontal-bar' : 'bar', y: undefined, categoryOrder: 'value-desc', barLayout: 'grouped', xLabel: field.label },
    view: { ...view, summary: 'count', groupBy: undefined },
  }
}

/** The chart kind that suits an x/y pair, mirroring the explorer's own inference. */
function kindFor(x: SheetbaseField | undefined, y: SheetbaseField, xProfile?: FieldProfile): { kind: ChartKind; summary: SummaryKind } {
  if (!x) return { kind: 'histogram', summary: 'none' }
  if (x.dataType === 'date' || x.dataType === 'datetime') return { kind: 'line', summary: 'mean' }
  if (isCategorical(x, xProfile)) return { kind: y.dataType === 'number' ? 'box' : 'bar', summary: y.dataType === 'number' ? 'none' : 'count' }
  return { kind: 'scatter', summary: 'none' }
}

/** Put a field on an axis or the colour channel of the current chart. */
export function assignRole(
  role: FieldRole,
  field: SheetbaseField,
  fields: readonly SheetbaseField[],
  profiles: ReadonlyMap<string, FieldProfile>,
  spec: ChartSpec,
  view: AnalysisView,
): { spec: ChartSpec; view: AnalysisView } {
  if (role === 'color') {
    return { spec: { ...spec, color: spec.color === field.id ? undefined : field.id, hiddenSeries: [] }, view }
  }
  if (role === 'x') {
    const y = fields.find((item) => item.id === spec.y)
    if (!y || y.id === field.id) return chartForField(field, profiles.get(field.id), spec, view)
    const { kind, summary } = kindFor(field, y, profiles.get(field.id))
    return { spec: { ...spec, x: field.id, kind, xLabel: undefined, zoomX: undefined }, view: { ...view, summary } }
  }
  const x = fields.find((item) => item.id === spec.x && item.id !== field.id)
  const { kind, summary } = kindFor(x, field, x ? profiles.get(x.id) : undefined)
  if (!x) return { spec: { ...spec, ...CLEARED, x: field.id, y: undefined, kind: 'histogram' }, view: { ...view, summary: 'none', groupBy: undefined } }
  return { spec: { ...spec, y: field.id, kind, yLabel: undefined }, view: { ...view, summary } }
}
