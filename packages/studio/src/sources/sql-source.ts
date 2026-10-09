import type {
  FieldDataType,
  FieldProfile,
  HistogramQuery,
  HistogramResponse,
  PageQuery,
  PageResponse,
  ProfileQuery,
  ProfileResponse,
  SampleQuery,
  SampleResponse,
  SheetbaseField,
  SourceCapabilities,
  StudioDataSource,
  TableInfo,
  WorkspaceAggregateQuery,
  WorkspaceAggregateResponse,
} from '@sheetbase-labs/sheetbase-shared'
import { effectiveFilter, throwIfAborted } from '../lib/filters'
import { binEdges } from '../lib/rows'
import { filterToSql, quoteIdent, quoteLiteral, textExpr } from '../lib/sql-compile'

/**
 * A DuckDB connection, however it is hosted — DuckDB-WASM in the browser,
 * `@duckdb/node-api` in tests. Rows come back as plain JS values: BigInt is
 * narrowed to number and lists to arrays by the engine.
 */
export interface SqlEngine {
  query(sql: string): Promise<Record<string, unknown>[]>
  dispose?(): void
}

/** DuckDB column type → Sheetbase field type. */
export function duckTypeToField(raw: string): FieldDataType {
  const type = raw.toUpperCase().trim()
  if (/^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC|INT\d+|FLOAT\d+)/.test(type)) return 'number'
  if (type === 'BOOLEAN' || type === 'BOOL') return 'boolean'
  if (type === 'DATE') return 'date'
  if (type.startsWith('TIMESTAMP') || type === 'DATETIME') return 'datetime'
  return 'text'
}

/** How a column is projected into rows: the same text form the predicate reads. */
export function projectColumn(field: Pick<SheetbaseField, 'id' | 'dataType'>): string {
  const c = quoteIdent(field.id)
  switch (field.dataType) {
    case 'number': return `CAST(${c} AS DOUBLE) AS ${c}`
    case 'boolean': return `${c} AS ${c}`
    case 'date': return `strftime(CAST(${c} AS DATE), '%Y-%m-%d') AS ${c}`
    case 'datetime': return `strftime(CAST(${c} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%gZ') AS ${c}`
    default: return `CAST(${c} AS VARCHAR) AS ${c}`
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = toNumber(value)
  return Number.isFinite(n) ? n : null
}

const SUMMARY_SQL: Record<Exclude<WorkspaceAggregateQuery['summary'], 'count' | 'median'>, string> = {
  mean: 'avg',
  sum: 'sum',
  min: 'min',
  max: 'max',
}

interface Registered {
  info: TableInfo
  relation: string
  types: Map<string, FieldDataType>
}

export interface SqlSourceOptions {
  id: string
  label: string
  kind: string
  engine: SqlEngine
  /** Allow read-only SQL that registers a derived table. Default true. */
  sql?: boolean
  /** Deterministic sampling; default 42. */
  sampleSeed?: number
}

/**
 * A `StudioDataSource` over any DuckDB connection: filters compile with
 * `filterToSql` (buildPredicate semantics), and paging, aggregation,
 * profiling, binning and sampling all run inside the engine.
 */
export class DuckDbSqlSource implements StudioDataSource {
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly capabilities: SourceCapabilities
  readonly engine: SqlEngine
  readonly #tables = new Map<string, Registered>()
  #queryCount = 0
  readonly #seed: number
  #chain: Promise<unknown> = Promise.resolve()

  constructor(options: SqlSourceOptions) {
    this.id = options.id
    this.label = options.label
    this.kind = options.kind
    this.engine = options.engine
    this.#seed = options.sampleSeed ?? 42
    this.capabilities = { sql: options.sql !== false, sqlDialect: 'duckdb', profile: true, histogram: true, sample: true }
  }

  /** Serialise engine access — one DuckDB connection runs one statement at a time. */
  protected run(sql: string): Promise<Record<string, unknown>[]> {
    const next = this.#chain.then(() => this.engine.query(sql))
    this.#chain = next.catch(() => undefined)
    return next
  }

  /** Register a relation (table or view name) the engine already knows. */
  async registerTable(id: string, relation: string, extra: Partial<Pick<TableInfo, 'label' | 'kind' | 'sql' | 'description'>> = {}): Promise<TableInfo> {
    const described = await this.run(`DESCRIBE SELECT * FROM ${relation}`)
    const fields: SheetbaseField[] = described.map((row) => {
      const name = String(row.column_name)
      return { id: name, label: name, dataType: duckTypeToField(String(row.column_type)), nullable: String(row.null ?? 'YES') !== 'NO' }
    })
    const [counted] = await this.run(`SELECT count(*) AS n FROM ${relation}`)
    const info: TableInfo = {
      id,
      label: extra.label ?? id,
      rowCount: toNumber(counted?.n ?? 0),
      fields,
      kind: extra.kind ?? 'table',
      ...(extra.sql ? { sql: extra.sql } : {}),
      ...(extra.description ? { description: extra.description } : {}),
    }
    this.#tables.set(id, { info, relation, types: new Map(fields.map((field) => [field.id, field.dataType])) })
    return info
  }

  async catalog(): Promise<readonly TableInfo[]> {
    return [...this.#tables.values()].map((entry) => entry.info)
  }

  #table(id: string): Registered {
    const entry = this.#tables.get(id)
    if (!entry) throw new Error(`Unknown table: ${id}`)
    return entry
  }

  #fields(entry: Registered, ids: readonly string[]): SheetbaseField[] {
    const wanted = ids.length ? ids : entry.info.fields.map((field) => field.id)
    return wanted.flatMap((id) => {
      const field = entry.info.fields.find((item) => item.id === id)
      return field ? [field] : []
    })
  }

  #where(entry: Registered, filter: Parameters<typeof filterToSql>[0]): string {
    return filterToSql(filter, entry.types)
  }

  async page(tableId: string, query: PageQuery, signal?: AbortSignal): Promise<PageResponse> {
    throwIfAborted(signal)
    const entry = this.#table(tableId)
    const where = this.#where(entry, effectiveFilter(query))
    const fields = this.#fields(entry, query.fieldIds)
    const order = (query.sort ?? [])
      .filter((clause) => entry.types.has(clause.fieldId))
      .map((clause) => `${quoteIdent(clause.fieldId)} ${clause.direction === 'desc' ? 'DESC' : 'ASC'} NULLS ${clause.nulls === 'first' ? 'FIRST' : 'LAST'}`)
    const projection = fields.length ? fields.map(projectColumn).join(', ') : '1 AS __none'
    const rows = await this.run(
      `SELECT ${projection} FROM ${entry.relation} WHERE ${where}${order.length ? ` ORDER BY ${order.join(', ')}` : ''} LIMIT ${Math.max(0, Math.floor(query.rowCount))} OFFSET ${Math.max(0, Math.floor(query.rowStart))}`,
    )
    const [counted] = await this.run(`SELECT count(*) AS n FROM ${entry.relation} WHERE ${where}`)
    throwIfAborted(signal)
    return {
      records: rows.map((values, index) => ({ recordId: String(query.rowStart + index), values: fields.length ? values : {} })),
      totalRows: toNumber(counted?.n ?? 0),
    }
  }

  async aggregate(tableId: string, query: WorkspaceAggregateQuery, signal?: AbortSignal): Promise<WorkspaceAggregateResponse> {
    throwIfAborted(signal)
    const entry = this.#table(tableId)
    const where = this.#where(entry, query.filter)
    const col = (field: string) => ({ sql: entry.types.has(field) ? quoteIdent(field) : 'CAST(NULL AS VARCHAR)', type: entry.types.get(field) ?? 'text' as FieldDataType })
    const seriesBy = (query.seriesBy ?? []).filter((field) => field !== query.groupBy)
    const dims = [query.groupBy, ...seriesBy]
    const dimSelect = dims.map((field, index) => `${textExpr(col(field))} AS d${index}`)
    let valueExpr = 'NULL'
    if (query.valueField !== undefined) {
      const value = col(query.valueField)
      valueExpr = value.type === 'number' ? `CAST(${value.sql} AS DOUBLE)` : `try_cast(nullif(trim(${textExpr(value)}), '') AS DOUBLE)`
    }
    const agg = query.summary === 'count' ? 'count(*)'
      : query.summary === 'median' ? 'median(v)'
      : `${SUMMARY_SQL[query.summary]}(v)`
    const dimCols = dims.map((_, index) => `d${index}`)
    const sql = `SELECT ${dimCols.join(', ')}, count(*) AS n, ${agg} AS v FROM (SELECT ${dimSelect.join(', ')}, ${valueExpr} AS v FROM ${entry.relation} WHERE ${where}) GROUP BY ${dimCols.join(', ')} ORDER BY ${dimCols.join(', ')}${query.limit && query.limit > 0 ? ` LIMIT ${Math.floor(query.limit)}` : ''}`
    const rows = await this.run(sql)
    const [counted] = await this.run(`SELECT count(*) AS n FROM ${entry.relation} WHERE ${where}`)
    throwIfAborted(signal)
    return {
      buckets: rows.map((row) => ({
        key: String(row.d0 ?? ''),
        ...(seriesBy.length ? { series: Object.fromEntries(seriesBy.map((field, index) => [field, String(row[`d${index + 1}`] ?? '')])) } : {}),
        count: toNumber(row.n),
        value: query.summary === 'count' ? toNumber(row.n) : toNullableNumber(row.v),
      })),
      totalRows: toNumber(counted?.n ?? 0),
    }
  }

  async profile(tableId: string, query: ProfileQuery, signal?: AbortSignal): Promise<ProfileResponse> {
    throwIfAborted(signal)
    const entry = this.#table(tableId)
    const where = this.#where(entry, query.filter)
    const fields = this.#fields(entry, query.fields)
    const bins = Math.max(1, Math.floor(query.bins ?? 20))
    const topN = Math.max(0, Math.floor(query.top ?? 8))
    const base = `(SELECT * FROM ${entry.relation} WHERE ${where})`
    // One pass for counts and moments across every field.
    const parts: string[] = ['count(*) AS n']
    fields.forEach((field, index) => {
      const c = quoteIdent(field.id)
      const blank = field.dataType === 'text' || field.dataType === 'relationship'
        ? `(${c} IS NULL OR trim(CAST(${c} AS VARCHAR)) = '')`
        : `(${c} IS NULL)`
      parts.push(`count(*) FILTER (WHERE ${blank}) AS nul${index}`)
      parts.push(`count(DISTINCT ${c}) FILTER (WHERE NOT ${blank}) AS dis${index}`)
      if (field.dataType === 'number') {
        const x = `CAST(${c} AS DOUBLE)`
        parts.push(`min(${x}) AS min${index}`, `max(${x}) AS max${index}`, `avg(${x}) AS mean${index}`, `stddev_samp(${x}) AS std${index}`)
        parts.push(`quantile_cont(${x}, [0.05, 0.25, 0.5, 0.75, 0.95]) AS q${index}`)
      } else if (field.dataType === 'date' || field.dataType === 'datetime') {
        const ms = `epoch_ms(CAST(${c} AS TIMESTAMP))`
        parts.push(`CAST(min(${ms}) AS DOUBLE) AS min${index}`, `CAST(max(${ms}) AS DOUBLE) AS max${index}`)
      }
    })
    const [stats = {}] = await this.run(`SELECT ${parts.join(', ')} FROM ${base}`)
    const total = toNumber(stats.n ?? 0)
    const profiles: FieldProfile[] = []
    for (const [index, field] of fields.entries()) {
      throwIfAborted(signal)
      const c = quoteIdent(field.id)
      const typed = { sql: c, type: field.dataType }
      const top = topN > 0
        ? (await this.run(`SELECT ${textExpr(typed)} AS v, count(*) AS n FROM ${base} WHERE ${c} IS NOT NULL AND trim(${textExpr(typed)}) <> '' GROUP BY 1 ORDER BY n DESC, v ASC LIMIT ${topN}`))
          .map((row) => ({ value: String(row.v), count: toNumber(row.n) }))
        : undefined
      const minRaw = toNullableNumber(stats[`min${index}`])
      const maxRaw = toNullableNumber(stats[`max${index}`])
      let histogram: FieldProfile['histogram'] = null
      if ((field.dataType === 'number' || field.dataType === 'date' || field.dataType === 'datetime') && minRaw !== null && maxRaw !== null) {
        const x = field.dataType === 'number' ? `CAST(${c} AS DOUBLE)` : `CAST(epoch_ms(CAST(${c} AS TIMESTAMP)) AS DOUBLE)`
        histogram = await this.#bins(base, x, minRaw, maxRaw, bins)
      }
      const isDate = field.dataType === 'date' || field.dataType === 'datetime'
      const iso = (ms: number | null) => (ms === null ? null : field.dataType === 'date' ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString())
      const q = stats[`q${index}`]
      const quantiles = Array.isArray(q) && q.length === 5
        ? { p05: toNumber(q[0]), p25: toNumber(q[1]), p50: toNumber(q[2]), p75: toNumber(q[3]), p95: toNumber(q[4]) }
        : null
      profiles.push({
        field: field.id,
        count: total,
        nulls: toNumber(stats[`nul${index}`] ?? 0),
        distinct: toNumber(stats[`dis${index}`] ?? 0),
        ...(field.dataType === 'number' ? {
          min: minRaw,
          max: maxRaw,
          mean: toNullableNumber(stats[`mean${index}`]),
          std: toNullableNumber(stats[`std${index}`]),
          quantiles,
        } : {}),
        ...(isDate ? { min: iso(minRaw), max: iso(maxRaw) } : {}),
        ...(top ? { top } : {}),
        histogram,
      })
    }
    return { totalRows: total, profiles }
  }

  /** Equal-width bins over [min, max]; the last bin is closed. */
  async #bins(base: string, x: string, min: number, max: number, bins: number): Promise<{ edges: number[]; counts: number[] }> {
    const { edges, width } = binEdges(min, max, bins)
    const count = edges.length - 1
    const rows = await this.run(
      `SELECT least(greatest(CAST(floor((${x} - ${edges[0]}) / ${width}) AS INTEGER), 0), ${count - 1}) AS b, count(*) AS n FROM ${base} WHERE ${x} IS NOT NULL GROUP BY 1`,
    )
    const counts = new Array<number>(count).fill(0)
    for (const row of rows) counts[toNumber(row.b)] = toNumber(row.n)
    return { edges, counts }
  }

  async histogram(tableId: string, query: HistogramQuery, signal?: AbortSignal): Promise<HistogramResponse> {
    throwIfAborted(signal)
    const entry = this.#table(tableId)
    const type = entry.types.get(query.field)
    if (type !== 'number' && type !== 'date' && type !== 'datetime') throw new Error(`Histogram needs a numeric or date field: ${query.field}`)
    const where = this.#where(entry, query.filter)
    const base = `(SELECT * FROM ${entry.relation} WHERE ${where})`
    const c = quoteIdent(query.field)
    const x = type === 'number' ? `CAST(${c} AS DOUBLE)` : `CAST(epoch_ms(CAST(${c} AS TIMESTAMP)) AS DOUBLE)`
    const [range = {}] = await this.run(`SELECT min(${x}) AS lo, max(${x}) AS hi, count(*) AS n, count(*) FILTER (WHERE ${c} IS NULL) AS nul FROM ${base}`)
    const totalRows = toNumber(range.n ?? 0)
    const nulls = toNumber(range.nul ?? 0)
    const lo = toNullableNumber(range.lo)
    const hi = toNullableNumber(range.hi)
    if (lo === null || hi === null) return { field: query.field, edges: [], series: [], totalRows, nulls }
    const bins = query.binWidth && query.binWidth > 0
      ? Math.max(1, Math.min(1000, Math.ceil((hi - lo) / query.binWidth) || 1))
      : Math.max(1, Math.floor(query.bins ?? 20))
    if (!query.by || !entry.types.has(query.by)) {
      const { edges, counts } = await this.#bins(base, x, lo, hi, bins)
      return { field: query.field, edges, series: [{ key: null, counts }], totalRows, nulls }
    }
    const byCol = { sql: quoteIdent(query.by), type: entry.types.get(query.by) as FieldDataType }
    const { edges, width } = binEdges(lo, hi, bins)
    const count = edges.length - 1
    const rows = await this.run(
      `SELECT ${textExpr(byCol)} AS s, least(greatest(CAST(floor((${x} - ${edges[0]}) / ${width}) AS INTEGER), 0), ${count - 1}) AS b, count(*) AS n FROM ${base} WHERE ${x} IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    )
    const series = new Map<string, number[]>()
    for (const row of rows) {
      const key = String(row.s ?? '')
      let counts = series.get(key)
      if (!counts) { counts = new Array<number>(count).fill(0); series.set(key, counts) }
      counts[toNumber(row.b)] = toNumber(row.n)
    }
    throwIfAborted(signal)
    return { field: query.field, edges, series: [...series.entries()].map(([key, counts]) => ({ key, counts })), totalRows, nulls }
  }

  async sample(tableId: string, query: SampleQuery, signal?: AbortSignal): Promise<SampleResponse> {
    throwIfAborted(signal)
    const entry = this.#table(tableId)
    const where = this.#where(entry, query.filter)
    const fields = this.#fields(entry, query.fields)
    const n = Math.max(1, Math.floor(query.n))
    const [counted] = await this.run(`SELECT count(*) AS n FROM ${entry.relation} WHERE ${where}`)
    const totalRows = toNumber(counted?.n ?? 0)
    const projection = fields.map(projectColumn).join(', ') || '1 AS __none'
    const sampled = totalRows > n
    const rows = await this.run(sampled
      ? `SELECT ${projection} FROM (SELECT * FROM ${entry.relation} WHERE ${where}) AS s USING SAMPLE reservoir(${n} ROWS) REPEATABLE (${Math.floor(query.seed ?? this.#seed)})`
      : `SELECT ${projection} FROM ${entry.relation} WHERE ${where}`)
    throwIfAborted(signal)
    return { rows, totalRows, sampled }
  }

  async sql(text: string, signal?: AbortSignal): Promise<TableInfo> {
    throwIfAborted(signal)
    if (!this.capabilities.sql) throw new Error('This source does not allow SQL.')
    const statement = cleanStatement(text)
    this.#queryCount += 1
    const id = `query_${this.#queryCount}`
    const relation = quoteIdent(id)
    // CREATE VIEW only accepts a query, so DDL/DML (and a second statement)
    // is a parse error rather than something that runs.
    await this.run(`CREATE OR REPLACE TEMP VIEW ${relation} AS (\n${statement}\n)`)
    try {
      return await this.registerTable(id, relation, { label: `Query ${this.#queryCount}`, kind: 'query', sql: statement })
    } catch (error) {
      await this.run(`DROP VIEW IF EXISTS ${relation}`).catch(() => undefined)
      throw error
    }
  }

  dispose(): void {
    this.engine.dispose?.()
  }
}

/**
 * Strip comments-at-the-end and trailing semicolons, and reject anything that
 * isn't a single SELECT/WITH/FROM/VALUES/PIVOT query — a fast, readable error
 * before the engine's own (view-wrapping) guard.
 */
export function cleanStatement(text: string): string {
  const trimmed = text.trim().replace(/;+\s*$/, '').trim()
  if (!trimmed) throw new Error('Write a query first.')
  const head = trimmed.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, '').slice(0, 12).toUpperCase()
  if (!/^(SELECT|WITH|FROM|VALUES|PIVOT|UNPIVOT|\()/.test(head)) {
    throw new Error('Only read-only queries (SELECT … / WITH …) can run here.')
  }
  return trimmed
}

export { quoteIdent, quoteLiteral }
