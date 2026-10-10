import type { FieldDataType, FilterNode, GroupNode } from '@sheetbase-labs/sheetbase-shared'

/**
 * Filter tree → DuckDB SQL. Two modes:
 *
 * - `exact` mirrors `buildPredicate` (packages/shared/src/predicate.ts) so a
 *   SQL-backed source returns the same rows the in-memory evaluator would.
 *   It reads each column's declared type plus the expected value's JS type
 *   and emits the same arm `looseEqual`/`asComparable` would take. Every
 *   condition is null-free (COALESCEd), so NOT (= NOR) can't be flipped by
 *   a NULL. `fixtures/filter-parity.json` pins the behaviour; the Python
 *   compiler is tested against the same file.
 * - `readable` is what a scientist would write by hand for typed columns —
 *   the "show as SQL" view. It is not used for execution.
 *
 * Literals are inlined (single quotes doubled, identifiers double-quoted),
 * which keeps the output copy-pasteable and needs no parameter plumbing.
 *
 * Residual divergences, all on mixed-type text columns: DuckDB's casts are
 * stricter than JS `Number()`/`Date.parse` (hex, '1e3 ', slashed dates), and
 * numbers are rendered to text as integers or DuckDB's shortest repr.
 */

export type ColumnTypes = ReadonlyMap<string, FieldDataType> | Readonly<Record<string, FieldDataType>>

export interface CompileOptions {
  /** Reference instant for `withinLastDays` — the predicate uses `Date.now()`. */
  now?: number
  mode?: 'exact' | 'readable'
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function numberLiteral(value: number): string {
  return String(value)
}

// --- JS value classification — copies of the predicate's private helpers. ---

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asDate(value: unknown): number | null {
  if (value instanceof Date) {
    const stamp = value.getTime()
    return Number.isNaN(stamp) ? null : stamp
  }
  const text = asText(value).trim()
  if (!/[-/:]/.test(text) || !/\d{4}/.test(text)) return null
  const stamp = Date.parse(text)
  return Number.isNaN(stamp) ? null : stamp
}

type Comparable = { kind: 'num' | 'date'; value: number }

function asComparable(value: unknown): Comparable | null {
  const n = asNum(value)
  if (n !== null) return { kind: 'num', value: n }
  const d = asDate(value)
  return d === null ? null : { kind: 'date', value: d }
}

function betweenBounds(value: unknown): { low: Comparable; high: Comparable } | null {
  let lowRaw: unknown
  let highRaw: unknown
  if (Array.isArray(value) && value.length >= 2) {
    [lowRaw, highRaw] = value
  } else if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
    lowRaw = (value as { low: unknown }).low
    highRaw = (value as { high: unknown }).high
  } else {
    return null
  }
  const low = asComparable(lowRaw)
  const high = asComparable(highRaw)
  if (low === null || high === null || low.kind !== high.kind) return null
  return { low, high }
}

// --- Column expressions ---

interface Column {
  /** SQL expression for the raw column (or a typed NULL for unknown fields). */
  sql: string
  type: FieldDataType
}

function lookupType(types: ColumnTypes, field: string): { name: string; type: FieldDataType } | null {
  const entries: [string, FieldDataType][] = types instanceof Map ? [...types.entries()] : Object.entries(types)
  const exact = entries.find(([name]) => name === field)
  if (exact) return { name: exact[0], type: exact[1] }
  // `cell()` falls back to a case-insensitive key match.
  const lower = field.toLowerCase()
  const loose = entries.find(([name]) => name.toLowerCase() === lower)
  return loose ? { name: loose[0], type: loose[1] } : null
}

function column(types: ColumnTypes, field: string): Column {
  const found = lookupType(types, field)
  if (!found) return { sql: 'CAST(NULL AS VARCHAR)', type: 'text' }
  return { sql: quoteIdent(found.name), type: found.type }
}

/** The value as the JS row would hold it, rendered to text (`asText`). */
export function textExpr(col: Column): string {
  const c = col.sql
  switch (col.type) {
    case 'number':
      return `coalesce(CASE WHEN ${c} = trunc(${c}) AND abs(${c}) < 1e15 THEN CAST(CAST(${c} AS BIGINT) AS VARCHAR) ELSE CAST(${c} AS VARCHAR) END, '')`
    case 'boolean':
      return `coalesce(CAST(${c} AS VARCHAR), '')`
    case 'date':
      return `coalesce(strftime(CAST(${c} AS DATE), '%Y-%m-%d'), '')`
    case 'datetime':
      return `coalesce(strftime(CAST(${c} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%gZ'), '')`
    default:
      return `coalesce(CAST(${c} AS VARCHAR), '')`
  }
}

/** `asNum` over a text column. */
function textAsNumber(col: Column): string {
  return `try_cast(nullif(trim(replace(CAST(${col.sql} AS VARCHAR), ',', '')), '') AS DOUBLE)`
}

/** `asDate` over a text column (epoch ms), NULL when the text isn't date-shaped. */
function textAsEpoch(col: Column): string {
  const t = `trim(CAST(${col.sql} AS VARCHAR))`
  return `CASE WHEN regexp_matches(${t}, '[-/:]') AND regexp_matches(${t}, '\\d{4}') THEN epoch_ms(try_cast(${t} AS TIMESTAMP)) END`
}

/** Epoch ms of a date/datetime column. */
function epochOf(col: Column): string {
  return `epoch_ms(CAST(${col.sql} AS TIMESTAMP))`
}

function nonNull(expr: string): string {
  return `coalesce(${expr}, false)`
}

// --- Conditions (exact) ---

function textEq(col: Column, expected: unknown): string {
  return `(lower(${textExpr(col)}) = ${quoteLiteral(asText(expected).toLowerCase())})`
}

function eqExact(col: Column, expected: unknown): string {
  if (typeof expected === 'boolean') {
    if (col.type === 'boolean') return nonNull(`${col.sql} = ${expected ? 'TRUE' : 'FALSE'}`)
    const set = expected ? "('true', 'yes', '1')" : "('false', 'no', '0')"
    return `(lower(${textExpr(col)}) IN ${set})`
  }
  const expectedNum = asNum(expected)
  const expectedDate = asDate(expected)
  const numericArm = expectedNum !== null && asText(expected).trim() !== ''
  // What happens when the actual value is NOT numeric: date arm, else text.
  const fallthrough = (dateCol: () => string) => (expectedDate !== null ? dateCol() : textEq(col, expected))
  if (col.type === 'number') {
    // A number's text has no date separators, so the date arm never fires.
    return numericArm ? nonNull(`${col.sql} = ${numberLiteral(expectedNum)}`) : textEq(col, expected)
  }
  if (col.type === 'date' || col.type === 'datetime') {
    // ISO dates never parse as numbers; date-vs-date compares instants.
    return expectedDate !== null ? nonNull(`${epochOf(col)} = ${expectedDate}`) : textEq(col, expected)
  }
  if (col.type === 'boolean') return textEq(col, expected)
  // Text (and relationship) columns: the dispatch happens per row.
  const asNumber = textAsNumber(col)
  const asEpoch = textAsEpoch(col)
  const dateArm = () => `CASE WHEN ${asEpoch} IS NOT NULL THEN ${asEpoch} = ${expectedDate} ELSE ${textEq(col, expected)} END`
  if (numericArm) {
    return `(CASE WHEN ${asNumber} IS NOT NULL THEN ${asNumber} = ${numberLiteral(expectedNum)} ELSE ${fallthrough(dateArm)} END)`
  }
  return `(${fallthrough(dateArm)})`
}

function compareExact(col: Column, op: '>' | '>=' | '<' | '<=', bound: Comparable): string {
  if (col.type === 'number') return bound.kind === 'num' ? nonNull(`${col.sql} ${op} ${numberLiteral(bound.value)}`) : 'FALSE'
  if (col.type === 'date' || col.type === 'datetime') return bound.kind === 'date' ? nonNull(`${epochOf(col)} ${op} ${bound.value}`) : 'FALSE'
  if (col.type === 'boolean') return 'FALSE'
  const asNumber = textAsNumber(col)
  const asEpoch = textAsEpoch(col)
  return bound.kind === 'num'
    ? nonNull(`${asNumber} ${op} ${numberLiteral(bound.value)}`)
    : nonNull(`CASE WHEN ${asNumber} IS NULL THEN ${asEpoch} ${op} ${bound.value} END`)
}

function blankExpr(col: Column): string {
  if (col.type === 'number' || col.type === 'boolean' || col.type === 'date' || col.type === 'datetime') return `(${col.sql} IS NULL)`
  return `(${col.sql} IS NULL OR trim(CAST(${col.sql} AS VARCHAR)) = '')`
}

function isoDay(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10)
}

function conditionExact(col: Column, operator: string, value: unknown, now: number): string {
  switch (operator) {
    case 'isNull':
      return blankExpr(col)
    case 'notNull':
      return `(NOT ${blankExpr(col)})`
    case 'eq':
      return eqExact(col, value)
    case 'neq':
      return `(NOT ${eqExact(col, value)})`
    case 'contains':
      return `contains(lower(${textExpr(col)}), ${quoteLiteral(asText(value).toLowerCase())})`
    case 'startsWith':
      return `starts_with(lower(${textExpr(col)}), ${quoteLiteral(asText(value).toLowerCase())})`
    case 'endsWith':
      return `ends_with(lower(${textExpr(col)}), ${quoteLiteral(asText(value).toLowerCase())})`
    case 'in': {
      if (!Array.isArray(value) || value.length === 0) return 'FALSE'
      return `(${value.map((item) => eqExact(col, item)).join(' OR ')})`
    }
    case 'between': {
      const bounds = betweenBounds(value)
      if (!bounds) return 'FALSE'
      const low = { kind: bounds.low.kind, value: Math.min(bounds.low.value, bounds.high.value) }
      const high = { kind: bounds.low.kind, value: Math.max(bounds.low.value, bounds.high.value) }
      return `(${compareExact(col, '>=', low)} AND ${compareExact(col, '<=', high)})`
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const bound = asComparable(value)
      if (!bound) return 'FALSE'
      const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator] as '>' | '>=' | '<' | '<='
      return compareExact(col, op, bound)
    }
    case 'withinLastDays': {
      const days = asNum(value)
      if (days === null || days <= 0) return 'FALSE'
      const today = isoDay(now)
      const start = isoDay(now - (days - 1) * 86_400_000)
      const day = col.type === 'date' || col.type === 'datetime'
        ? `strftime(CAST(${col.sql} AS TIMESTAMP), '%Y-%m-%d')`
        : col.type === 'text' || col.type === 'relationship'
          ? `strftime(make_timestamp(${textAsEpoch(col)} * 1000), '%Y-%m-%d')`
          : null
      if (!day) return 'FALSE'
      return nonNull(`${day} BETWEEN ${quoteLiteral(start)} AND ${quoteLiteral(today)}`)
    }
    default:
      // An operator we can't evaluate must not silently match everything.
      throw new Error(`Unsupported filter operator: ${operator}`)
  }
}

// --- Conditions (readable) ---

function readableValue(col: Column, value: unknown): string {
  if (typeof value === 'number') return numberLiteral(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (col.type === 'number' && asNum(value) !== null) return numberLiteral(asNum(value) as number)
  if (col.type === 'date') return `DATE ${quoteLiteral(asText(value))}`
  if (col.type === 'datetime') return `TIMESTAMP ${quoteLiteral(asText(value))}`
  return quoteLiteral(asText(value))
}

function conditionReadable(col: Column, operator: string, value: unknown, now: number): string {
  const c = col.sql
  const text = col.type === 'text' || col.type === 'relationship'
  switch (operator) {
    case 'isNull': return `${c} IS NULL`
    case 'notNull': return `${c} IS NOT NULL`
    case 'eq': return text && typeof value === 'string' ? `lower(${c}) = ${quoteLiteral(value.toLowerCase())}` : `${c} = ${readableValue(col, value)}`
    case 'neq': return text && typeof value === 'string' ? `lower(${c}) <> ${quoteLiteral(value.toLowerCase())}` : `${c} <> ${readableValue(col, value)}`
    case 'contains': return `${c} ILIKE ${quoteLiteral(`%${asText(value)}%`)}`
    case 'startsWith': return `${c} ILIKE ${quoteLiteral(`${asText(value)}%`)}`
    case 'endsWith': return `${c} ILIKE ${quoteLiteral(`%${asText(value)}`)}`
    case 'in': return Array.isArray(value) ? `${c} IN (${value.map((item) => readableValue(col, item)).join(', ')})` : 'FALSE'
    case 'between': {
      const [low, high] = Array.isArray(value) ? value : [undefined, undefined]
      return `${c} BETWEEN ${readableValue(col, low)} AND ${readableValue(col, high)}`
    }
    case 'gt': return `${c} > ${readableValue(col, value)}`
    case 'gte': return `${c} >= ${readableValue(col, value)}`
    case 'lt': return `${c} < ${readableValue(col, value)}`
    case 'lte': return `${c} <= ${readableValue(col, value)}`
    case 'withinLastDays': {
      const days = asNum(value) ?? 0
      return `${c} >= DATE ${quoteLiteral(isoDay(now - (days - 1) * 86_400_000))}`
    }
    default: throw new Error(`Unsupported filter operator: ${operator}`)
  }
}

/**
 * Compile a filter tree to a WHERE expression. AND/OR/NOT follow
 * `buildPredicate`: AND of nothing is TRUE, OR of nothing is FALSE, and NOT
 * is NOR (true when no child matches).
 */
export function filterToSql(node: FilterNode | undefined, types: ColumnTypes, options: CompileOptions = {}): string {
  if (!node) return 'TRUE'
  const now = options.now ?? Date.now()
  const mode = options.mode ?? 'exact'
  const walk = (current: FilterNode, depth: number): string => {
    if (current.type === 'condition') {
      const col = column(types, current.field)
      return mode === 'exact'
        ? conditionExact(col, current.operator, current.value, now)
        : conditionReadable(col, current.operator, current.value, now)
    }
    const parts = current.children.map((child) => walk(child, depth + 1))
    if (current.combinator === 'OR') return parts.length ? `(${parts.join(' OR ')})` : 'FALSE'
    if (current.combinator === 'NOT') return parts.length ? `(NOT (${parts.join(' OR ')}))` : 'TRUE'
    if (!parts.length) return 'TRUE'
    return parts.length === 1 && depth === 0 ? parts[0] : `(${parts.join(' AND ')})`
  }
  return walk(node, 0)
}

/** True when a tree matches every row without looking at any (an empty filter). */
export function isEmptyFilter(node: GroupNode | undefined): boolean {
  if (!node) return true
  if (node.combinator === 'NOT') return node.children.length === 0
  if (node.combinator === 'OR') return false
  return node.children.every((child) => child.type === 'group' && isEmptyFilter(child))
}
