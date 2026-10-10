import { basename, extname, resolve } from 'node:path'
import { quoteIdent, quoteLiteral } from '@sheetbase-labs/sheetbase-studio/node'

export type DbKind = 'postgres' | 'mysql' | 'sqlite' | 'duckdb'

/** The DuckDB extension each kind needs (DuckDB files need none). */
export const EXTENSION_FOR: Readonly<Record<DbKind, string | null>> = {
  postgres: 'postgres_scanner',
  mysql: 'mysql_scanner',
  sqlite: 'sqlite_scanner',
  duckdb: null,
}

export interface DbTarget {
  kind: DbKind
  /** What ATTACH receives: a libpq URI, a MySQL key=value string, or a file path. */
  connection: string
  /** Catalog name inside DuckDB. */
  alias: string
  /** Shown to people: the URL without its password. */
  display: string
}

const RESERVED = new Set(['main', 'temp', 'system', 'memory'])

function sanitise(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z_]/.test(cleaned) ? cleaned : `db_${cleaned || 'source'}`
}

function uniqueAlias(wanted: string, taken: Set<string>): string {
  let alias = sanitise(wanted)
  if (RESERVED.has(alias)) alias = `${alias}_db`
  let candidate = alias
  for (let n = 2; taken.has(candidate); n++) candidate = `${alias}_${n}`
  taken.add(candidate)
  return candidate
}

function redact(url: URL): string {
  const copy = new URL(url.href)
  if (copy.password) copy.password = '***'
  return copy.href
}

/** MySQL's ATTACH takes key=value pairs; values with spaces or quotes are quoted. */
function mysqlConnection(url: URL): string {
  const value = (raw: string) => (/[\s'"\\]/.test(raw) ? `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : raw)
  const pairs: [string, string][] = []
  if (url.hostname) pairs.push(['host', url.hostname])
  if (url.port) pairs.push(['port', url.port])
  if (url.username) pairs.push(['user', decodeURIComponent(url.username)])
  if (url.password) pairs.push(['passwd', decodeURIComponent(url.password)])
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (database) pairs.push(['db', database])
  for (const [key, val] of url.searchParams) pairs.push([key, val])
  return pairs.map(([key, val]) => `${key}=${value(val)}`).join(' ')
}

/**
 * Parse `--db`: a URL (`postgres://`, `postgresql://`, `mysql://`,
 * `sqlite:///path`, `duckdb:///path`) or a path to a `.sqlite`/`.db`/`.duckdb`
 * file, optionally prefixed with a name: `lims=postgres://…`.
 */
export function parseDbTarget(raw: string, taken: Set<string>, cwd = process.cwd()): DbTarget {
  let spec = raw.trim()
  let name: string | undefined
  const named = /^([A-Za-z_][\w-]*)=(.+)$/.exec(spec)
  if (named?.[1] && named[2] && /^(\w+:\/\/|[./~\\]|[A-Za-z]:[\\/]|[^=]+\.(sqlite3?|db|duckdb|ddb)$)/i.test(named[2])) {
    name = named[1]
    spec = named[2]
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(spec)?.[1]?.toLowerCase()
  if (scheme === 'postgres' || scheme === 'postgresql') {
    const url = new URL(spec)
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
    return { kind: 'postgres', connection: spec, alias: uniqueAlias(name ?? database, taken), display: redact(url) }
  }
  if (scheme === 'mysql' || scheme === 'mariadb') {
    const url = new URL(spec.replace(/^mariadb:/i, 'mysql:'))
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'mysql'
    return { kind: 'mysql', connection: mysqlConnection(url), alias: uniqueAlias(name ?? database, taken), display: redact(url) }
  }
  let kind: DbKind
  let path: string
  if (scheme === 'sqlite' || scheme === 'duckdb') {
    kind = scheme
    path = spec.replace(/^[a-z]+:\/\//i, '')
  } else if (scheme) {
    throw new Error(`Unsupported database URL: ${scheme}://. Use postgres://, mysql://, sqlite:// or duckdb://, or a .sqlite/.duckdb file.`)
  } else {
    path = spec
    const extension = extname(spec).toLowerCase()
    if (extension === '.duckdb' || extension === '.ddb') kind = 'duckdb'
    else if (extension === '.sqlite' || extension === '.sqlite3' || extension === '.db') kind = 'sqlite'
    else throw new Error(`Can't tell what kind of database ${spec} is. Use a .sqlite/.db/.duckdb file, or a postgres:// / mysql:// URL.`)
  }
  const absolute = resolve(cwd, path.replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? '~'))
  const stem = basename(absolute, extname(absolute))
  return { kind, connection: absolute, alias: uniqueAlias(name ?? stem, taken), display: absolute }
}

/** The ATTACH statement: always read-only. */
export function attachStatement(target: DbTarget): string {
  const type = target.kind === 'duckdb' ? '' : `TYPE ${target.kind}, `
  return `ATTACH ${quoteLiteral(target.connection)} AS ${quoteIdent(target.alias)} (${type}READ_ONLY)`
}

/** Schemas that hold a database's own catalogue, not its data. */
export function isSystemSchema(schema: string): boolean {
  const lower = schema.toLowerCase()
  return lower === 'information_schema' || lower === 'pg_catalog' || lower === 'pg_toast' || lower.startsWith('pg_temp') || lower === 'mysql' || lower === 'performance_schema' || lower === 'sys'
}

/** SQL listing an attached database's tables and views. */
export function listTablesSql(alias: string): string {
  const db = quoteLiteral(alias)
  return `SELECT schema_name AS schema, table_name AS name FROM duckdb_tables() WHERE database_name = ${db}
UNION ALL
SELECT schema_name AS schema, view_name AS name FROM duckdb_views() WHERE database_name = ${db} AND NOT internal
ORDER BY 1, 2`
}

export interface AttachedTable {
  /**
   * Catalog id, which is also its name in SQL: `name`, or `schema_name` when
   * the chosen tables span several schemas.
   */
  id: string
  /** Readable label: `name` or `schema.name`. */
  label: string
  /** Fully quoted DuckDB relation. */
  relation: string
  schema: string
  name: string
}

/**
 * Turn listed tables into catalog entries, skipping system schemas. `keep`
 * applies `--table` first, so names are schema-qualified only when the tables
 * actually chosen span several schemas.
 */
export function attachedTables(alias: string, rows: readonly { schema: unknown; name: unknown }[], keep: (table: { schema: string; name: string }) => boolean = () => true): AttachedTable[] {
  const tables = rows
    .map((row) => ({ schema: String(row.schema), name: String(row.name) }))
    .filter((table) => !isSystemSchema(table.schema) && keep(table))
  const schemas = new Set(tables.map((table) => table.schema))
  return tables.map((table) => ({
    ...table,
    id: schemas.size > 1 ? `${table.schema}_${table.name}` : table.name,
    label: schemas.size > 1 ? `${table.schema}.${table.name}` : table.name,
    relation: `${quoteIdent(alias)}.${quoteIdent(table.schema)}.${quoteIdent(table.name)}`,
  }))
}

/** Does a `--table` selector pick this table? Accepts `name`, `schema.name` or `alias.schema.name`. */
export function matchesSelector(selector: string, alias: string, table: { schema: string; name: string }): boolean {
  const wanted = selector.toLowerCase()
  const names = [table.name, `${table.schema}.${table.name}`, `${alias}.${table.schema}.${table.name}`, `${alias}.${table.name}`]
  return names.some((name) => name.toLowerCase() === wanted)
}
