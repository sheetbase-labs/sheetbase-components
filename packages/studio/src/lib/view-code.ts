import type { AnalysisView, FieldDataType, FilterNode, SheetbaseField } from '@sheetbase-labs/sheetbase-shared'
import { filterToSql, isEmptyFilter, quoteIdent } from './sql-compile'

/**
 * "Show as code": the current view written the way a person would write it
 * in SQL, Ibis or pandas, for typed columns. These are teaching and
 * hand-off aids — the studio itself executes the exact compilers, and the
 * Python package's `sheetbase.apply_view()` reproduces the exact semantics.
 */

export interface ViewChart {
  /** Category / x field when the chart aggregates. */
  x?: string
  /** Measure for mean/median/sum/min/max. */
  y?: string
  /** Series fields (group/colour/facet). */
  series?: readonly string[]
}

export interface ViewCodeInput {
  table: string
  fields: readonly SheetbaseField[]
  view: AnalysisView
  chart?: ViewChart
  now?: number
}

const PY_AGG: Record<string, string> = { mean: 'mean', median: 'median', sum: 'sum', min: 'min', max: 'max' }

function typeOf(fields: readonly SheetbaseField[], id: string): FieldDataType {
  return fields.find((field) => field.id === id)?.dataType ?? 'text'
}

function pyString(value: string): string {
  return JSON.stringify(value)
}

function pyValue(type: FieldDataType, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (value === null || value === undefined) return 'None'
  if (type === 'number' && value !== '' && Number.isFinite(Number(value))) return String(Number(value))
  return pyString(String(value))
}

function pyIdent(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !['and', 'or', 'not', 'in', 'is', 'if', 'else', 'for', 'class', 'def', 'lambda', 'from', 'import', 'count'].includes(id)
}

function aggregateOf(input: ViewCodeInput): { groupBy: string[]; summary: string; measure?: string } | null {
  const { view, chart } = input
  if (view.summary === 'none') return null
  const x = chart?.x ?? view.groupBy
  if (!x) return null
  const groupBy = [x, ...(chart?.series ?? []), ...(view.groupBy && view.groupBy !== x ? [view.groupBy] : [])]
    .filter((field, index, all) => all.indexOf(field) === index)
  if (view.summary !== 'count' && !chart?.y) return null
  return { groupBy, summary: view.summary, measure: view.summary === 'count' ? undefined : chart?.y }
}

// --- SQL ---

export function viewToSql(input: ViewCodeInput): string {
  const types = Object.fromEntries(input.fields.map((field) => [field.id, field.dataType]))
  const where = isEmptyFilter(input.view.filter) ? null : filterToSql(input.view.filter, types, { mode: 'readable', now: input.now })
  const from = `FROM ${quoteIdent(input.table)}`
  const agg = aggregateOf(input)
  if (agg) {
    const dims = agg.groupBy.map(quoteIdent)
    const measure = agg.summary === 'count' ? 'count(*) AS n' : `${agg.summary === 'mean' ? 'avg' : agg.summary}(${quoteIdent(agg.measure ?? '')}) AS ${quoteIdent(`${agg.summary}_${agg.measure}`)}`
    return [
      `SELECT ${[...dims, ...(agg.summary === 'count' ? [] : ['count(*) AS n']), measure].join(', ')}`,
      from,
      ...(where ? [`WHERE ${where}`] : []),
      `GROUP BY ${dims.join(', ')}`,
      `ORDER BY ${dims.join(', ')}`,
      ...(input.view.limit ? [`LIMIT ${input.view.limit}`] : []),
    ].join('\n')
  }
  return [
    'SELECT *',
    from,
    ...(where ? [`WHERE ${where}`] : []),
    ...(input.view.sort ? [`ORDER BY ${quoteIdent(input.view.sort.field)} ${input.view.sort.direction.toUpperCase()}`] : []),
    ...(input.view.limit ? [`LIMIT ${input.view.limit}`] : []),
  ].join('\n')
}

// --- Ibis ---

function ibisColumn(id: string): string {
  return pyIdent(id) ? `_.${id}` : `_[${pyString(id)}]`
}

function ibisCondition(node: FilterNode, fields: readonly SheetbaseField[], now: number): string {
  if (node.type === 'group') {
    const parts = node.children.map((child) => ibisCondition(child, fields, now))
    if (node.combinator === 'NOT') return parts.length ? `~(${parts.join(' | ')})` : 'ibis.literal(True)'
    if (!parts.length) return node.combinator === 'OR' ? 'ibis.literal(False)' : 'ibis.literal(True)'
    return parts.length === 1 ? parts[0] as string : `(${parts.join(node.combinator === 'OR' ? ' | ' : ' & ')})`
  }
  const type = typeOf(fields, node.field)
  const col = ibisColumn(node.field)
  const text = type === 'text' || type === 'relationship'
  const value = node.value
  switch (node.operator) {
    case 'isNull': return text ? `(${col}.isnull() | (${col}.strip() == ""))` : `${col}.isnull()`
    case 'notNull': return text ? `(${col}.notnull() & (${col}.strip() != ""))` : `${col}.notnull()`
    case 'eq': return text && typeof value === 'string' ? `(${col}.lower() == ${pyString(value.toLowerCase())})` : `(${col} == ${pyValue(type, value)})`
    case 'neq': return text && typeof value === 'string' ? `(${col}.lower() != ${pyString(value.toLowerCase())})` : `(${col} != ${pyValue(type, value)})`
    case 'contains': return `${col}.cast("string").lower().contains(${pyString(String(value ?? '').toLowerCase())})`
    case 'startsWith': return `${col}.cast("string").lower().startswith(${pyString(String(value ?? '').toLowerCase())})`
    case 'endsWith': return `${col}.cast("string").lower().endswith(${pyString(String(value ?? '').toLowerCase())})`
    case 'in': return `${col}.isin([${(Array.isArray(value) ? value : []).map((item) => pyValue(type, item)).join(', ')}])`
    case 'between': {
      const [low, high] = Array.isArray(value) ? value : []
      return `${col}.between(${pyValue(type, low)}, ${pyValue(type, high)})`
    }
    case 'gt': return `(${col} > ${pyValue(type, value)})`
    case 'gte': return `(${col} >= ${pyValue(type, value)})`
    case 'lt': return `(${col} < ${pyValue(type, value)})`
    case 'lte': return `(${col} <= ${pyValue(type, value)})`
    case 'withinLastDays': {
      const days = Number(value) || 0
      const start = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10)
      return `(${col} >= ibis.date(${pyString(start)}))`
    }
    default: return 'ibis.literal(True)'
  }
}

export function viewToIbis(input: ViewCodeInput): string {
  const now = input.now ?? Date.now()
  const lines = [
    'import ibis',
    'from ibis import _',
    '',
    `t = con.table(${pyString(input.table)})  # or: t = ibis.memtable(df)`,
  ]
  let name = 't'
  if (!isEmptyFilter(input.view.filter)) {
    lines.push(`rows = t.filter(${ibisCondition(input.view.filter, input.fields, now)})`)
    name = 'rows'
  }
  const agg = aggregateOf(input)
  if (agg) {
    const measure = agg.summary === 'count' ? 'n=_.count()' : `n=_.count(), ${pyIdent(`${agg.summary}_${agg.measure}`) ? `${agg.summary}_${agg.measure}` : 'value'}=${ibisColumn(agg.measure ?? '')}.${PY_AGG[agg.summary]}()`
    lines.push(`result = ${name}.group_by([${agg.groupBy.map(pyString).join(', ')}]).agg(${measure}).order_by([${agg.groupBy.map(pyString).join(', ')}])`)
    name = 'result'
  } else if (input.view.sort) {
    lines.push(`${name} = ${name}.order_by(${input.view.sort.direction === 'desc' ? `ibis.desc(${pyString(input.view.sort.field)})` : pyString(input.view.sort.field)})`)
  }
  if (input.view.limit) lines.push(`${name} = ${name}.limit(${input.view.limit})`)
  lines.push(`${name}.to_pandas()`, '', '# Exact Sheetbase filter semantics (null handling, loose text/number matching):', `# from sheetbase import apply_view; apply_view(t, view)`)
  return lines.join('\n')
}

// --- pandas ---

function pandasColumn(id: string): string {
  return `df[${pyString(id)}]`
}

function pandasCondition(node: FilterNode, fields: readonly SheetbaseField[], now: number): string {
  if (node.type === 'group') {
    const parts = node.children.map((child) => pandasCondition(child, fields, now))
    if (node.combinator === 'NOT') return parts.length ? `~(${parts.join(' | ')})` : 'True'
    if (!parts.length) return node.combinator === 'OR' ? 'False' : 'True'
    return parts.length === 1 ? parts[0] as string : `(${parts.join(node.combinator === 'OR' ? ' | ' : ' & ')})`
  }
  const type = typeOf(fields, node.field)
  const col = pandasColumn(node.field)
  const text = type === 'text' || type === 'relationship'
  const value = node.value
  const str = `${col}.astype("string").str.lower()`
  switch (node.operator) {
    case 'isNull': return text ? `(${col}.isna() | (${col}.astype("string").str.strip() == ""))` : `${col}.isna()`
    case 'notNull': return text ? `(${col}.notna() & (${col}.astype("string").str.strip() != ""))` : `${col}.notna()`
    case 'eq': return text && typeof value === 'string' ? `(${str} == ${pyString(value.toLowerCase())})` : `(${col} == ${pyValue(type, value)})`
    case 'neq': return text && typeof value === 'string' ? `(${str} != ${pyString(value.toLowerCase())})` : `(${col} != ${pyValue(type, value)})`
    case 'contains': return `${str}.str.contains(${pyString(String(value ?? '').toLowerCase())}, regex=False, na=False)`
    case 'startsWith': return `${str}.str.startswith(${pyString(String(value ?? '').toLowerCase())}, na=False)`
    case 'endsWith': return `${str}.str.endswith(${pyString(String(value ?? '').toLowerCase())}, na=False)`
    case 'in': return `${col}.isin([${(Array.isArray(value) ? value : []).map((item) => pyValue(type, item)).join(', ')}])`
    case 'between': {
      const [low, high] = Array.isArray(value) ? value : []
      return `${col}.between(${pyValue(type, low)}, ${pyValue(type, high)})`
    }
    case 'gt': return `(${col} > ${pyValue(type, value)})`
    case 'gte': return `(${col} >= ${pyValue(type, value)})`
    case 'lt': return `(${col} < ${pyValue(type, value)})`
    case 'lte': return `(${col} <= ${pyValue(type, value)})`
    case 'withinLastDays': {
      const days = Number(value) || 0
      const start = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10)
      return `(pd.to_datetime(${col}) >= ${pyString(start)})`
    }
    default: return 'True'
  }
}

export function viewToPandas(input: ViewCodeInput): string {
  const now = input.now ?? Date.now()
  const lines = ['import pandas as pd', '', `df = ...  # the ${pyString(input.table)} table as a DataFrame`]
  let name = 'df'
  if (!isEmptyFilter(input.view.filter)) {
    lines.push(`rows = df[${pandasCondition(input.view.filter, input.fields, now)}]`)
    name = 'rows'
  }
  const agg = aggregateOf(input)
  if (agg) {
    const keys = `[${agg.groupBy.map(pyString).join(', ')}]`
    lines.push(agg.summary === 'count'
      ? `result = ${name}.groupby(${keys}, dropna=False).size().reset_index(name="n")`
      : `result = ${name}.groupby(${keys}, dropna=False)[${pyString(agg.measure ?? '')}].agg(["count", ${pyString(PY_AGG[agg.summary] ?? 'mean')}]).reset_index()`)
    name = 'result'
  } else if (input.view.sort) {
    lines.push(`${name} = ${name}.sort_values(${pyString(input.view.sort.field)}, ascending=${input.view.sort.direction === 'asc' ? 'True' : 'False'})`)
  }
  if (input.view.limit) lines.push(`${name} = ${name}.head(${input.view.limit})`)
  lines.push(name)
  return lines.join('\n')
}

