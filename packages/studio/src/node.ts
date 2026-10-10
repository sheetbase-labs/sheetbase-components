// Server-side entry: the data layer without the React UI or its CSS, for hosts
// that run Studio's sources outside a browser (the `sheetbase-studio` binary).
export { DuckDbSource, ACCEPTED_FILE_TYPES, detectFormat, tableNameFor, type DuckDbSourceOptions, type FileFormat, type FileLike } from './sources/file'
export { DuckDbSqlSource, cleanStatement, duckTypeToField, projectColumn, quoteIdent, quoteLiteral, type SqlEngine, type SqlSourceOptions } from './sources/sql-source'
export { plainValue, type FileSqlEngine } from './sources/duckdb-wasm'
export type { CatalogResponse } from './sources/http'
