import {
  buildPredicate,
  isBlank,
  type FieldDataType,
  type FieldProfile,
  type GroupNode,
  type HistogramResponse,
  type SheetbaseField,
  type SortClause,
  type WorkspaceAggregateQuery,
  type WorkspaceAggregateResponse,
} from '@sheetbase-labs/sheetbase-shared'

/**
 * In-memory implementations of the studio operations. They are the
 * reference the SQL and Python executors are compared against: filters use
 * `buildPredicate`, aggregates mirror the example API's memory engine, and
 * quantiles are linear-interpolated (`quantile_cont`).
 */

export type Row = Record<string, unknown>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/** Infer field types from values (numbers, booleans, ISO dates/datetimes, text). */
export function inferFields(rows: readonly Row[], sampleSize = 5000): SheetbaseField[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const sample = rows.length > sampleSize ? rows.slice(0, sampleSize) : rows
  for (const row of sample) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); keys.push(key) }
    }
  }
  return keys.map((key) => {
    const present = sample.map((row) => row[key]).filter((value) => !isBlank(value))
    let dataType: FieldDataType = 'text'
    if (present.length) {
      if (present.every((value) => (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint')) dataType = 'number'
      else if (present.every((value) => typeof value === 'boolean')) dataType = 'boolean'
      else if (present.every((value) => value instanceof Date || (typeof value === 'string' && (ISO_DATE.test(value) || ISO_DATETIME.test(value)) && !Number.isNaN(Date.parse(value))))) {
        const dateOnly = (value: unknown) => (typeof value === 'string' && ISO_DATE.test(value))
          || (value instanceof Date && value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0)
        dataType = present.every(dateOnly) ? 'date' : 'datetime'
      }
    }
    return { id: key, label: key, dataType, nullable: present.length < sample.length }
  })
}

/** Normalise host values so every executor sees the same JSON-shaped row. */
export function normaliseRow(row: Row, fields: readonly SheetbaseField[]): Row {
  const out: Row = {}
  for (const field of fields) {
    const value = row[field.id]
    if (value instanceof Date) {
      out[field.id] = Number.isNaN(value.getTime()) ? null
        : field.dataType === 'date' ? value.toISOString().slice(0, 10) : value.toISOString()
    } else if (typeof value === 'bigint') {
      out[field.id] = Number(value)
    } else {
      out[field.id] = value === undefined ? null : value
    }
  }
  return out
}

export function filterRows(rows: readonly Row[], filter?: GroupNode): Row[] {
  if (!filter) return [...rows]
  const predicate = buildPredicate(filter)
  return rows.filter(predicate)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asEpoch(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value !== 'string' || !/\d{4}/.test(value)) return null
  const stamp = Date.parse(value)
  return Number.isNaN(stamp) ? null : stamp
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Multi-key sort; nulls last unless the clause says first. */
export function sortRows(rows: readonly Row[], sort: readonly SortClause[] = []): Row[] {
  if (!sort.length) return [...rows]
  return [...rows].sort((left, right) => {
    for (const clause of sort) {
      const a = left[clause.fieldId]
      const b = right[clause.fieldId]
      const aBlank = a === null || a === undefined
      const bBlank = b === null || b === undefined
      if (aBlank || bBlank) {
        if (aBlank && bBlank) continue
        const nullsFirst = clause.nulls === 'first'
        return (aBlank ? 1 : -1) * (nullsFirst ? -1 : 1)
      }
      const sign = clause.direction === 'desc' ? -1 : 1
      const an = asNumber(a)
      const bn = asNumber(b)
      const order = an !== null && bn !== null ? an - bn : compareText(text(a), text(b))
      if (order !== 0) return order * sign
    }
    return 0
  })
}

/** Group + summarise, keyed by (groupBy × seriesBy) — the aggregate contract. */
export function aggregateRows(rows: readonly Row[], query: WorkspaceAggregateQuery): WorkspaceAggregateResponse {
  const filtered = filterRows(rows, query.filter)
  const seriesBy = (query.seriesBy ?? []).filter((field) => field !== query.groupBy)
  const buckets = new Map<string, { key: string; series?: Record<string, string>; count: number; values: number[] }>()
  for (const row of filtered) {
    const key = text(row[query.groupBy])
    const seriesValues = seriesBy.map((field) => text(row[field]))
    const mapKey = JSON.stringify([key, ...seriesValues])
    let bucket = buckets.get(mapKey)
    if (!bucket) {
      bucket = { key, ...(seriesBy.length ? { series: Object.fromEntries(seriesBy.map((field, index) => [field, seriesValues[index] ?? ''])) } : {}), count: 0, values: [] }
      buckets.set(mapKey, bucket)
    }
    bucket.count++
    if (query.valueField !== undefined) {
      const value = asNumber(row[query.valueField])
      if (value !== null) bucket.values.push(value)
    }
  }
  const summarised = [...buckets.values()].map((bucket) => {
    let value: number | null = null
    if (query.summary === 'count') value = bucket.count
    else if (bucket.values.length) {
      const values = bucket.values
      if (query.summary === 'sum') value = values.reduce((sum, item) => sum + item, 0)
      else if (query.summary === 'mean') value = values.reduce((sum, item) => sum + item, 0) / values.length
      else if (query.summary === 'min') value = Math.min(...values)
      else if (query.summary === 'max') value = Math.max(...values)
      else value = quantile([...values].sort((a, b) => a - b), 0.5)
    }
    return { key: bucket.key, ...(bucket.series ? { series: bucket.series } : {}), count: bucket.count, value }
  })
  summarised.sort((left, right) => compareText(left.key, right.key)
    || compareText(JSON.stringify(Object.values(left.series ?? {})), JSON.stringify(Object.values(right.series ?? {}))))
  const limit = query.limit && query.limit > 0 ? query.limit : undefined
  return { buckets: limit ? summarised.slice(0, limit) : summarised, totalRows: filtered.length }
}

/** Linear-interpolated quantile of sorted values (DuckDB `quantile_cont`). */
export function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const lo = sorted[lower] as number
  const hi = sorted[upper] as number
  return lo + (hi - lo) * (position - lower)
}

/** Equal-width edges; a constant column gets one unit-wide bin around its value. */
export function binEdges(min: number, max: number, bins: number): { edges: number[]; width: number } {
  if (max <= min) return { edges: [min - 0.5, min + 0.5], width: 1 }
  const width = (max - min) / bins
  const edges = Array.from({ length: bins + 1 }, (_, index) => (index === bins ? max : min + index * width))
  return { edges, width }
}

function binCounts(values: readonly number[], edges: readonly number[], width: number): number[] {
  const count = edges.length - 1
  const counts = new Array<number>(count).fill(0)
  const start = edges[0] as number
  for (const value of values) {
    const index = Math.min(Math.max(Math.floor((value - start) / width), 0), count - 1)
    counts[index] = (counts[index] ?? 0) + 1
  }
  return counts
}

function measure(field: SheetbaseField, value: unknown): number | null {
  if (field.dataType === 'number') return asNumber(value)
  if (field.dataType === 'date' || field.dataType === 'datetime') return asEpoch(value)
  return null
}

export function profileRows(rows: readonly Row[], field: SheetbaseField, options: { bins?: number; top?: number } = {}): FieldProfile {
  const bins = Math.max(1, Math.floor(options.bins ?? 20))
  const topN = Math.max(0, Math.floor(options.top ?? 8))
  let nulls = 0
  const distinct = new Set<string>()
  const counts = new Map<string, number>()
  const values: number[] = []
  for (const row of rows) {
    const value = row[field.id]
    if (isBlank(value)) { nulls++; continue }
    const key = text(value)
    distinct.add(key)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    const measured = measure(field, value)
    if (measured !== null) values.push(measured)
  }
  const top = topN > 0
    ? [...counts.entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).slice(0, topN).map(([value, count]) => ({ value, count }))
    : undefined
  const profile: { -readonly [K in keyof FieldProfile]: FieldProfile[K] } = {
    field: field.id,
    count: rows.length,
    nulls,
    distinct: distinct.size,
    ...(top ? { top } : {}),
    histogram: null,
  }
  if (values.length && (field.dataType === 'number' || field.dataType === 'date' || field.dataType === 'datetime')) {
    const sorted = [...values].sort((a, b) => a - b)
    const min = sorted[0] as number
    const max = sorted[sorted.length - 1] as number
    const { edges, width } = binEdges(min, max, bins)
    profile.histogram = { edges, counts: binCounts(sorted, edges, width) }
    if (field.dataType === 'number') {
      const mean = sorted.reduce((sum, item) => sum + item, 0) / sorted.length
      profile.min = min
      profile.max = max
      profile.mean = mean
      profile.std = sorted.length > 1 ? Math.sqrt(sorted.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (sorted.length - 1)) : null
      profile.quantiles = { p05: quantile(sorted, 0.05), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p95: quantile(sorted, 0.95) }
    } else {
      const iso = (ms: number) => (field.dataType === 'date' ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString())
      profile.min = iso(min)
      profile.max = iso(max)
    }
  } else if (field.dataType === 'number') {
    Object.assign(profile, { min: null, max: null, mean: null, std: null, quantiles: null })
  }
  return profile
}

export function histogramRows(
  rows: readonly Row[],
  field: SheetbaseField,
  options: { bins?: number; binWidth?: number; by?: string } = {},
): HistogramResponse {
  let nulls = 0
  const points: { value: number; series: string | null }[] = []
  for (const row of rows) {
    const value = measure(field, row[field.id])
    if (value === null) { nulls++; continue }
    points.push({ value, series: options.by ? text(row[options.by]) : null })
  }
  if (!points.length) return { field: field.id, edges: [], series: [], totalRows: rows.length, nulls }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of points) { if (point.value < min) min = point.value; if (point.value > max) max = point.value }
  const bins = options.binWidth && options.binWidth > 0
    ? Math.max(1, Math.min(1000, Math.ceil((max - min) / options.binWidth) || 1))
    : Math.max(1, Math.floor(options.bins ?? 20))
  const { edges, width } = binEdges(min, max, bins)
  const groups = new Map<string | null, number[]>()
  for (const point of points) {
    const list = groups.get(point.series)
    if (list) list.push(point.value)
    else groups.set(point.series, [point.value])
  }
  const series = [...groups.entries()]
    .sort((a, b) => compareText(a[0] ?? '', b[0] ?? ''))
    .map(([key, list]) => ({ key, counts: binCounts(list, edges, width) }))
  return { field: field.id, edges, series, totalRows: rows.length, nulls }
}

/** Seeded PRNG (mulberry32) — same seed, same sample. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Reservoir sample preserving source order. */
export function sampleRows<T>(rows: readonly T[], n: number, seed = 42): T[] {
  if (rows.length <= n) return [...rows]
  const next = random(seed)
  const picked = Array.from({ length: n }, (_, index) => index)
  for (let index = n; index < rows.length; index++) {
    const slot = Math.floor(next() * (index + 1))
    if (slot < n) picked[slot] = index
  }
  return picked.sort((a, b) => a - b).map((index) => rows[index] as T)
}
