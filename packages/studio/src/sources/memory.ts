import type {
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
import { aggregateRows, filterRows, histogramRows, inferFields, normaliseRow, profileRows, sampleRows, sortRows, type Row } from '../lib/rows'
import type { DuckDbWasmOptions, FileSqlEngine } from './duckdb-wasm'
import { DuckDbSource, type FileLike } from './file'

export interface MemoryTableInput {
  id: string
  label?: string
  rows: readonly Row[]
  /** Declared types; inferred from the rows when omitted. */
  fields?: readonly SheetbaseField[]
  description?: string
}

export interface MemorySourceOptions {
  id?: string
  label?: string
  tables?: readonly MemoryTableInput[]
  /**
   * SQL and uploads run in DuckDB, started on first use. `false` disables
   * both; a function supplies the engine (tests, a shared instance).
   */
  duckdb?: false | (() => Promise<FileSqlEngine>)
  wasm?: DuckDbWasmOptions
}

interface MemoryTable {
  info: TableInfo
  rows: Row[]
}

/**
 * Rows the host already has — a pandas frame serialised to records, an API
 * response, a notebook cell's output. Exploration runs in JS with the same
 * semantics as every other executor; SQL and uploads hand over to a lazily
 * started DuckDB that holds a copy of these tables plus the new ones.
 */
export class MemorySource implements StudioDataSource {
  readonly id: string
  readonly label: string
  readonly kind = 'memory'
  readonly capabilities: SourceCapabilities
  readonly #tables = new Map<string, MemoryTable>()
  readonly #options: MemorySourceOptions
  #duck: Promise<DuckDbSource> | null = null
  readonly #duckTables = new Set<string>()

  constructor(options: MemorySourceOptions = {}) {
    this.id = options.id ?? 'memory'
    this.label = options.label ?? 'Local data'
    this.#options = options
    const sql = options.duckdb !== false
    this.capabilities = { sql, sqlDialect: sql ? 'duckdb' : undefined, profile: true, histogram: true, sample: true }
    for (const table of options.tables ?? []) this.addTable(table)
  }

  /** Add or replace a table of rows. */
  addTable(input: MemoryTableInput): TableInfo {
    const fields = input.fields ? [...input.fields] : inferFields(input.rows)
    const rows = input.rows.map((row) => normaliseRow(row, fields))
    const info: TableInfo = {
      id: input.id,
      label: input.label ?? input.id,
      rowCount: rows.length,
      fields,
      kind: 'table',
      ...(input.description ? { description: input.description } : {}),
    }
    this.#tables.set(input.id, { info, rows })
    return info
  }

  #duckSource(): Promise<DuckDbSource> {
    if (this.#options.duckdb === false) return Promise.reject(new Error('SQL is disabled for this source.'))
    if (!this.#duck) {
      const engine = this.#options.duckdb
      this.#duck = DuckDbSource.create({ id: `${this.id}:duckdb`, label: this.label, kind: 'memory', ...(engine ? { engine } : { wasm: this.#options.wasm }) })
        .then(async (duck) => {
          // SQL sees the host tables under their own ids.
          for (const table of this.#tables.values()) {
            await duck.addRows(table.rows, { name: table.info.id, id: table.info.id, label: table.info.label, fields: table.info.fields })
          }
          return duck
        })
      this.#duck.catch(() => { this.#duck = null })
    }
    return this.#duck
  }

  async catalog(): Promise<readonly TableInfo[]> {
    const local = [...this.#tables.values()].map((table) => table.info)
    if (!this.#duck || !this.#duckTables.size) return local
    const duck = await this.#duck
    const extra = (await duck.catalog()).filter((info) => this.#duckTables.has(info.id))
    return [...local, ...extra]
  }

  #local(tableId: string): MemoryTable | null {
    return this.#tables.get(tableId) ?? null
  }

  async #remote(tableId: string): Promise<DuckDbSource> {
    if (!this.#duckTables.has(tableId)) throw new Error(`Unknown table: ${tableId}`)
    return this.#duckSource()
  }

  #field(table: MemoryTable, id: string): SheetbaseField {
    const field = table.info.fields.find((item) => item.id === id)
    if (!field) throw new Error(`Unknown field: ${id}`)
    return field
  }

  async page(tableId: string, query: PageQuery, signal?: AbortSignal): Promise<PageResponse> {
    const table = this.#local(tableId)
    if (!table) return (await this.#remote(tableId)).page(tableId, query, signal)
    throwIfAborted(signal)
    const matched = sortRows(filterRows(table.rows, effectiveFilter(query)), query.sort)
    const start = Math.max(0, Math.floor(query.rowStart))
    const ids = query.fieldIds.length ? query.fieldIds : table.info.fields.map((field) => field.id)
    return {
      records: matched.slice(start, start + Math.max(0, Math.floor(query.rowCount))).map((row, index) => ({
        recordId: String(start + index),
        values: Object.fromEntries(ids.map((id) => [id, row[id] ?? null])),
      })),
      totalRows: matched.length,
    }
  }

  async aggregate(tableId: string, query: WorkspaceAggregateQuery, signal?: AbortSignal): Promise<WorkspaceAggregateResponse> {
    const table = this.#local(tableId)
    if (!table) return (await this.#remote(tableId)).aggregate(tableId, query, signal)
    throwIfAborted(signal)
    return aggregateRows(table.rows, query)
  }

  async profile(tableId: string, query: ProfileQuery, signal?: AbortSignal): Promise<ProfileResponse> {
    const table = this.#local(tableId)
    if (!table) return (await this.#remote(tableId)).profile(tableId, query, signal)
    throwIfAborted(signal)
    const rows = filterRows(table.rows, query.filter)
    const ids = query.fields.length ? query.fields : table.info.fields.map((field) => field.id)
    return {
      totalRows: rows.length,
      profiles: ids.map((id) => profileRows(rows, this.#field(table, id), { bins: query.bins, top: query.top })),
    }
  }

  async histogram(tableId: string, query: HistogramQuery, signal?: AbortSignal): Promise<HistogramResponse> {
    const table = this.#local(tableId)
    if (!table) return (await this.#remote(tableId)).histogram(tableId, query, signal)
    throwIfAborted(signal)
    const field = this.#field(table, query.field)
    if (field.dataType !== 'number' && field.dataType !== 'date' && field.dataType !== 'datetime') throw new Error(`Histogram needs a numeric or date field: ${query.field}`)
    return histogramRows(filterRows(table.rows, query.filter), field, { bins: query.bins, binWidth: query.binWidth, by: query.by })
  }

  async sample(tableId: string, query: SampleQuery, signal?: AbortSignal): Promise<SampleResponse> {
    const table = this.#local(tableId)
    if (!table) return (await this.#remote(tableId)).sample(tableId, query, signal)
    throwIfAborted(signal)
    const matched = filterRows(table.rows, query.filter)
    const picked = sampleRows(matched, Math.max(1, Math.floor(query.n)), query.seed)
    const ids = query.fields.length ? query.fields : table.info.fields.map((field) => field.id)
    return {
      rows: picked.map((row) => Object.fromEntries(ids.map((id) => [id, row[id] ?? null]))),
      totalRows: matched.length,
      sampled: matched.length > picked.length,
    }
  }

  async sql(text: string, signal?: AbortSignal): Promise<TableInfo> {
    const duck = await this.#duckSource()
    const info = await duck.sql(text, signal)
    this.#duckTables.add(info.id)
    return info
  }

  async upload(file: FileLike): Promise<readonly TableInfo[]> {
    const duck = await this.#duckSource()
    const tables = await duck.upload(file)
    for (const table of tables) this.#duckTables.add(table.id)
    return tables
  }

  dispose(): void {
    void this.#duck?.then((duck) => duck.dispose(), () => undefined)
  }
}
