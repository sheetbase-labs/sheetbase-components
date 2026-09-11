import { testCondition, toFilterClause } from 'sheetbase-shared'
import type { ChartSpec, DataRow, Dataset, FilterRule } from './types'

export const ROW_ID = '__sheetbaseRowId'
export const ERROR_LOW = '__sheetbaseErrorLow'
export const ERROR_HIGH = '__sheetbaseErrorHigh'

function matchesRule(row: DataRow, rule: FilterRule) {
  const clause = toFilterClause(rule)
  // Unknown operators pass so explorer behaviour stays compatible with older saved specs.
  if (!clause) return true
  return testCondition(row, clause)
}

// Tagging clones every row to inject ROW_ID, and the filter pass allocates a
// second array — both run once per caller, so three consumers (visible rows,
// chart raw + prepared, replicate summary) paid three passes per render.
// Caching keyed on the source rows array shares them. Rows are treated as
// immutable once loaded; the codebase convention is wholesale replacement.
const taggedCache = new WeakMap<readonly DataRow[], DataRow[]>()
const filteredCache = new WeakMap<readonly DataRow[], Map<string, DataRow[]>>()

function taggedRows(rows: readonly DataRow[]): DataRow[] {
  let tagged = taggedCache.get(rows)
  if (!tagged) {
    tagged = rows.map((row, index) => ({ ...row, [ROW_ID]: index }))
    taggedCache.set(rows, tagged)
  }
  return tagged
}

export function filteredRows(dataset: Dataset, spec: ChartSpec): DataRow[] {
  const filters = spec.filters ?? []
  const tagged = taggedRows(dataset.rows)
  if (!filters.length) return tagged
  const key = JSON.stringify({ filters, logic: spec.filterLogic ?? 'and' })
  let bySpec = filteredCache.get(tagged)
  if (!bySpec) {
    bySpec = new Map()
    filteredCache.set(tagged, bySpec)
  }
  const cached = bySpec.get(key)
  if (cached) {
    // Refresh recency: Map preserves insertion order for eviction.
    bySpec.delete(key)
    bySpec.set(key, cached)
    return cached
  }
  const filtered = tagged.filter((row) => (spec.filterLogic ?? 'and') === 'or'
    ? filters.some((rule) => matchesRule(row, rule))
    : filters.every((rule) => matchesRule(row, rule)))
  bySpec.set(key, filtered)
  // Bound retention: a filtered array per spec is cheap, but an interactive
  // session accumulates many specs against one dataset.
  while (bySpec.size > 8) bySpec.delete(bySpec.keys().next().value!)
  return filtered
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return undefined
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
}

function statisticalDimensions(spec: ChartSpec) {
  return [spec.x, spec.group, spec.color, spec.facet]
    .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
}

export function replicateSummary(dataset: Dataset, spec: ChartSpec) {
  if (!spec.x) return { groups: 0, eligibleGroups: 0, minN: 0, maxN: 0 }
  const dimensions = statisticalDimensions(spec)
  const counts = new Map<string, number>()
  for (const row of filteredRows(dataset, spec)) {
    const key = JSON.stringify(dimensions.map((field) => row[field]))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const values = [...counts.values()]
  return {
    groups: values.length,
    eligibleGroups: values.filter((count) => count >= 2).length,
    minN: values.length ? Math.min(...values) : 0,
    maxN: values.length ? Math.max(...values) : 0,
  }
}

export function preparedRows(dataset: Dataset, spec: ChartSpec): DataRow[] {
  const rows = filteredRows(dataset, spec)
  const errorMode = spec.errorMode ?? (spec.errorLow && spec.errorHigh ? 'explicit' : 'none')
  const calculatedError = ['sd', 'sem', 'ci95'].includes(errorMode)
  if (!spec.x || !spec.y || (spec.aggregate === 'none' && !calculatedError) || spec.kind === 'histogram' || spec.kind === 'box' || spec.kind === 'violin' || spec.kind === 'heatmap') return rows

  const dimensions = statisticalDimensions(spec)
  const groups = new Map<string, DataRow[]>()

  for (const row of rows) {
    const key = JSON.stringify(dimensions.map((field) => row[field]))
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return Array.from(groups.values(), (groupRows) => {
    const first = groupRows[0]!
    const values: number[] = []
    for (const row of groupRows) {
      const value = Number(row[spec.y!])
      if (Number.isFinite(value)) values.push(value)
    }
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN
    let summary = calculatedError && spec.aggregate === 'none' ? mean : (values[0] ?? Number.NaN)

    if (spec.aggregate === 'count') summary = groupRows.length
    else if (values.length) {
      if (spec.aggregate === 'sum') summary = values.reduce((sum, value) => sum + value, 0)
      else if (spec.aggregate === 'mean') summary = mean
      else if (spec.aggregate === 'median') summary = median(values)
      else if (spec.aggregate === 'min') summary = Math.min(...values)
      else if (spec.aggregate === 'max') summary = Math.max(...values)
    }

    const deviation = standardDeviation(values)
    const sem = deviation === undefined ? undefined : deviation / Math.sqrt(values.length)
    const margin = errorMode === 'sd'
      ? deviation
      : errorMode === 'sem'
        ? sem
        : errorMode === 'ci95' && sem !== undefined
          ? 1.96 * sem
          : undefined

    return {
      ...first,
      [spec.y!]: summary,
      ...(margin === undefined ? {} : { [ERROR_LOW]: summary - margin, [ERROR_HIGH]: summary + margin }),
      __sheetbaseCount: groupRows.length,
    }
  })
}
