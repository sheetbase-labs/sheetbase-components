import type { FieldDataType, SheetbaseField, TableInfo } from '@sheetbase-labs/sheetbase-shared'
import { inferFields, normaliseRow, type Row } from '../lib/rows'
import { createDuckDbWasmEngine, type DuckDbWasmOptions, type FileSqlEngine } from './duckdb-wasm'
import { DuckDbSqlSource, quoteIdent, quoteLiteral } from './sql-source'

export type FileFormat = 'csv' | 'tsv' | 'parquet' | 'json' | 'xlsx'

export const ACCEPTED_FILE_TYPES = '.csv,.tsv,.txt,.parquet,.pq,.json,.jsonl,.ndjson,.xlsx'

export function detectFormat(name: string): FileFormat | null {
  const lower = name.toLowerCase()
  if (/\.(csv|txt)$/.test(lower)) return 'csv'
  if (lower.endsWith('.tsv')) return 'tsv'
  if (/\.(parquet|pq)$/.test(lower)) return 'parquet'
  if (/\.(json|jsonl|ndjson)$/.test(lower)) return 'json'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  return null
}

/** A SQL-safe, readable, unique table name from a file (and sheet) name. */
export function tableNameFor(name: string, taken: ReadonlySet<string>): string {
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
  const base = /^[a-z_]/.test(stem) ? stem : `t_${stem}`
  let candidate = base
  for (let index = 2; taken.has(candidate); index++) candidate = `${base}_${index}`
  return candidate
}

const DUCK_TYPES: Record<FieldDataType, string> = {
  text: 'VARCHAR',
  number: 'DOUBLE',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'TIMESTAMP',
  relationship: 'VARCHAR',
}

/**
 * Rows → CSV for DuckDB's built-in reader. CSV (unlike JSON or Parquet) needs
 * no DuckDB extension, so ingestion works offline in the browser. Strings are
 * always quoted so an empty string stays distinct from NULL (an unquoted
 * empty field).
 */
export function rowsToCsv(rows: readonly Row[], fields: readonly SheetbaseField[]): string {
  const quote = (text: string) => `"${text.replace(/"/g, '""')}"`
  const lines = [fields.map((field) => quote(field.id)).join(',')]
  for (const row of rows) {
    lines.push(fields.map((field) => {
      const value = row[field.id]
      if (value === null || value === undefined) return ''
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (field.dataType === 'boolean') {
        const text = String(value).trim().toLowerCase()
        return text === 'true' || text === 'false' ? text : ''
      }
      if (field.dataType === 'number') {
        const n = Number(String(value).replace(/,/g, ''))
        return String(value).trim() !== '' && Number.isFinite(n) ? String(n) : ''
      }
      return quote(typeof value === 'object' ? JSON.stringify(value) : String(value))
    }).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** Parse a JSON upload: an array of objects, `{ rows: [...] }`-style, or newline-delimited JSON. */
export function parseJsonRows(text: string): Row[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    if (parsed && typeof parsed === 'object') {
      const firstArray = Object.values(parsed).find((value) => Array.isArray(value))
      if (Array.isArray(firstArray)) return firstArray as Row[]
      return [parsed as Row]
    }
  } catch {
    // Not one JSON document — try newline-delimited JSON.
  }
  return trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line) as Row
    } catch {
      throw new Error(`Line ${index + 1} is not valid JSON.`)
    }
  })
}

/** The minimal file surface: a browser `File` satisfies it. */
export interface FileLike {
  name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface DuckDbSourceOptions {
  id?: string
  label?: string
  kind?: string
  /** Supply an engine (tests, a shared instance); otherwise DuckDB-WASM starts on first use. */
  engine?: FileSqlEngine | (() => Promise<FileSqlEngine>)
  wasm?: DuckDbWasmOptions
}

/**
 * Files and host rows held in an in-browser DuckDB. Every operation is SQL in
 * the engine, so a 2 GB Parquet file explores the same way a 200-row CSV does.
 * The engine starts lazily: creating the source costs nothing.
 */
export class DuckDbSource extends DuckDbSqlSource {
  readonly #engine: FileSqlEngine
  readonly #taken = new Set<string>()

  private constructor(options: DuckDbSourceOptions, engine: FileSqlEngine) {
    super({ id: options.id ?? 'files', label: options.label ?? 'Files', kind: options.kind ?? 'file', engine })
    this.#engine = engine
  }

  static async create(options: DuckDbSourceOptions = {}): Promise<DuckDbSource> {
    const engine = typeof options.engine === 'function'
      ? await options.engine()
      : options.engine ?? await createDuckDbWasmEngine(options.wasm)
    return new DuckDbSource(options, engine)
  }

  #claim(name: string): string {
    const id = tableNameFor(name, this.#taken)
    this.#taken.add(id)
    return id
  }

  /** Ingest a file into one table per file (one per sheet for Excel). */
  async upload(file: FileLike): Promise<readonly TableInfo[]> {
    const format = detectFormat(file.name)
    if (!format) throw new Error(`Unsupported file type: ${file.name}. Use CSV, TSV, Parquet, JSON or Excel (.xlsx).`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (format === 'json') {
      const rows = parseJsonRows(new TextDecoder().decode(bytes))
      if (!rows.length) throw new Error(`${file.name} has no rows.`)
      return [await this.addRows(rows, { name: file.name, label: file.name, description: 'JSON upload' })]
    }
    if (format === 'xlsx') {
      const { default: readXlsxFile } = await import('read-excel-file/browser')
      const sheets = await readXlsxFile(new Blob([bytes]))
      const tables: TableInfo[] = []
      for (const sheet of sheets) {
        const [header = [], ...body] = sheet.data
        if (!header.length) continue
        const names = header.map((cell, index) => (cell === null || cell === undefined || String(cell).trim() === '' ? `column_${index + 1}` : String(cell).trim()))
        const rows = body.map((cells) => Object.fromEntries(names.map((name, index) => {
          const value = cells[index]
          return [name, value instanceof Date ? value.toISOString() : value ?? null]
        })))
        const label = sheets.length > 1 ? `${file.name} · ${sheet.sheet}` : file.name
        tables.push(await this.addRows(rows, { name: sheets.length > 1 ? `${file.name}_${sheet.sheet}` : file.name, label, description: 'Excel upload' }))
      }
      if (!tables.length) throw new Error(`${file.name} has no sheets with a header row.`)
      return tables
    }
    const id = this.#claim(file.name)
    // The engine may transfer (detach) the buffer it is given; keep ours for the fallback.
    const path = await this.#engine.registerFile(`${id}.${format}`, bytes.slice())
    const reader = format === 'parquet' ? `read_parquet(${quoteLiteral(path)})`
      : format === 'tsv' ? `read_csv(${quoteLiteral(path)}, delim = '\t', header = true, auto_detect = true)`
      : `read_csv(${quoteLiteral(path)}, header = true, auto_detect = true)`
    try {
      await this.run(`CREATE TABLE ${quoteIdent(id)} AS SELECT * FROM ${reader}`)
    } catch (error) {
      // DuckDB reads Parquet through an extension it may not be able to fetch
      // (offline, locked-down networks); a pure-JS reader takes over.
      if (format !== 'parquet') throw error
      this.#taken.delete(id)
      const [{ parquetReadObjects }, { compressors }] = await Promise.all([import('hyparquet'), import('hyparquet-compressors')])
      const rows = await parquetReadObjects({ file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, compressors })
      return [await this.addRows(rows as Row[], { name: file.name, label: file.name, description: 'Parquet upload' })]
    } finally {
      await this.#engine.dropFile?.(path).catch(() => undefined)
    }
    return [await this.registerTable(id, quoteIdent(id), { label: file.name, description: `${format.toUpperCase()} upload` })]
  }

  /**
   * Load rows the host already has. Declared `fields` fix the column types
   * (inferred types otherwise); dates are ISO strings in, DATE/TIMESTAMP in SQL.
   */
  async addRows(rows: readonly Row[], options: { name: string; label?: string; fields?: readonly SheetbaseField[]; id?: string; description?: string }): Promise<TableInfo> {
    const fields = options.fields ?? inferFields(rows)
    const id = options.id ?? this.#claim(options.name)
    if (options.id) this.#taken.add(options.id)
    if (!fields.length) throw new Error(`${options.label ?? options.name} has no columns.`)
    const path = await this.#engine.registerFile(`${id}.csv`, rowsToCsv(rows.map((row) => normaliseRow(row, fields)), fields))
    const columns = fields.map((field) => `${quoteLiteral(field.id)}: ${quoteLiteral(DUCK_TYPES[field.dataType])}`).join(', ')
    try {
      await this.run(`CREATE OR REPLACE TABLE ${quoteIdent(id)} AS SELECT * FROM read_csv(${quoteLiteral(path)}, header = true, auto_detect = false, delim = ',', quote = '"', escape = '"', nullstr = '', allow_quoted_nulls = false, columns = {${columns}})`)
    } finally {
      await this.#engine.dropFile?.(path).catch(() => undefined)
    }
    return this.registerTable(id, quoteIdent(id), { label: options.label ?? options.name, ...(options.description ? { description: options.description } : {}) })
  }
}
