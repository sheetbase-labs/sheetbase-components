import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DuckDbSource, detectFormat, quoteIdent, quoteLiteral } from '@sheetbase-labs/sheetbase-studio/node'
import { EXTENSION_FOR, attachStatement, attachedTables, listTablesSql, matchesSelector, parseDbTarget } from './attach'
import { createNativeEngine, type NativeEngine } from './engine'

export interface OpenStudioOptions {
  /** Files (CSV, TSV, Parquet, JSON, Excel) or directories of them. */
  files?: readonly string[]
  /** Database URLs or files: postgres://, mysql://, sqlite, duckdb. */
  databases?: readonly string[]
  /** Only these tables from the databases (`name`, `schema.name` or `alias.schema.name`). */
  tables?: readonly string[]
  /** Read-only SQL editor. Default true. */
  sql?: boolean
  /** Let people open more files from the browser. Default true. */
  upload?: boolean
  label?: string
  /** Path to a DuckDB extension file shipped with this build. */
  extensionPath(name: string): Promise<string>
  log?(line: string): void
  cwd?: string
}

export interface OpenedStudio {
  source: DuckDbSource
  engine: NativeEngine
  upload: boolean
  close(): void
}

const rowsLabel = (count: number | null) => (count === null ? 'rows counted on first use' : `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`)

/** Expand directories into the supported files directly inside them. */
function expandFiles(paths: readonly string[], cwd: string): string[] {
  return paths.flatMap((path) => {
    const absolute = resolve(cwd, path)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(absolute)
    } catch {
      throw new Error(`No such file: ${path}`)
    }
    if (!stat.isDirectory()) return [absolute]
    const found = readdirSync(absolute).filter((name) => detectFormat(name)).sort().map((name) => join(absolute, name))
    if (!found.length) throw new Error(`${path} has no CSV, TSV, Parquet, JSON or Excel files.`)
    return found
  })
}

/**
 * Open files and databases into one read-only DuckDB, then lock it down:
 * after this returns, SQL can't touch the filesystem or network beyond what
 * was opened, attached databases are read-only, and settings are frozen.
 */
export async function openStudio(options: OpenStudioOptions): Promise<OpenedStudio> {
  const log = options.log ?? (() => undefined)
  const cwd = options.cwd ?? process.cwd()
  const engine = await createNativeEngine()
  try {
    const source = await DuckDbSource.create({ engine, id: 'local', label: options.label ?? 'sheetbase-studio', kind: 'duckdb', sql: options.sql !== false })

    for (const path of expandFiles(options.files ?? [], cwd)) {
      const name = basename(path)
      if (!detectFormat(name)) throw new Error(`Unsupported file type: ${name}. Use CSV, TSV, Parquet, JSON or Excel (.xlsx).`)
      const opened = await source.openPath(path, name)
      if (opened) {
        if (detectFormat(name) === 'parquet') engine.allowPath(path)
        log(`  ${opened.id.padEnd(24)} ${name} · ${rowsLabel(opened.rowCount)}`)
        continue
      }
      const bytes = readFileSync(path)
      const tables = await source.upload({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
      for (const table of tables) log(`  ${table.id.padEnd(24)} ${table.label} · ${rowsLabel(table.rowCount)}`)
    }

    const aliases = new Set<string>()
    const loaded = new Set<string>()
    const selectors = [...(options.tables ?? [])]
    const matched = new Set<string>()
    for (const raw of options.databases ?? []) {
      const target = parseDbTarget(raw, aliases, cwd)
      const extension = EXTENSION_FOR[target.kind]
      if (extension && !loaded.has(extension)) {
        await engine.exec(`LOAD ${quoteLiteral(await options.extensionPath(extension))}`)
        // DuckDB 1.5's MySQL aggregate pushdown fails to bind filtered counts
        // ("Failed to bind column reference"); DuckDB aggregates the rows itself.
        if (extension === 'mysql_scanner') await engine.exec('SET mysql_aggregate_pushdown_enabled = false')
        loaded.add(extension)
      }
      try {
        await engine.exec(attachStatement(target))
      } catch (error) {
        throw new Error(`Couldn't open ${target.display}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      }
      if (target.kind === 'duckdb' || target.kind === 'sqlite') engine.allowPath(target.connection)
      const listed = (await engine.query(listTablesSql(target.alias))) as { schema: unknown; name: unknown }[]
      const chosen = attachedTables(target.alias, listed, (table) => !selectors.length || selectors.some((selector) => {
        const hit = matchesSelector(selector, target.alias, table)
        if (hit) matched.add(selector)
        return hit
      }))
      const existing = new Set((await source.catalog()).map((table) => table.id))
      log(`  ${target.alias} (${target.kind}) ${target.display}`)
      for (const table of chosen) {
        const id = existing.has(table.id) ? `${target.alias}_${table.id}` : table.id
        // A view named after the catalog id, so SQL (and "this view as code")
        // can say FROM assays rather than FROM lims.qc.assays.
        await engine.exec(`CREATE VIEW ${quoteIdent(id)} AS SELECT * FROM ${table.relation}`)
        await source.registerTable(id, quoteIdent(id), { label: table.label, description: `${target.kind} · ${target.alias}.${table.schema}.${table.name}`, countRows: false })
        existing.add(id)
        log(`    ${id}${table.label !== id ? `  (${table.label})` : ''}`)
      }
      if (!chosen.length) log(selectors.length ? '    (no tables match --table)' : '    (no tables)')
    }
    const unmatched = selectors.filter((selector) => !matched.has(selector))
    if (unmatched.length) throw new Error(`No table matches --table ${unmatched.join(', ')}.`)

    await engine.lockDown()
    return {
      source,
      engine,
      upload: options.upload !== false,
      close: () => engine.close(),
    }
  } catch (error) {
    engine.close()
    throw error
  }
}
