import '@sheetbase-labs/sheetbase-shared/theme.css'
import '@sheetbase-labs/sheetbase-shared/shell.css'
import './ui/studio.css'

export { SheetbaseStudio, type SheetbaseStudioProps, type TableRef } from './ui/Studio'
export { FieldBrowser, type FieldBrowserProps, type ProfileScope } from './ui/FieldBrowser'
export { SqlPane, type SqlPaneProps } from './ui/SqlPane'
export { DEFAULT_LAYOUT } from './ui/Workspace'

// Sources
export { MemorySource, type MemorySourceOptions, type MemoryTableInput } from './sources/memory'
export { DuckDbSource, ACCEPTED_FILE_TYPES, detectFormat, tableNameFor, type DuckDbSourceOptions, type FileFormat, type FileLike } from './sources/file'
export { DuckDbSqlSource, cleanStatement, duckTypeToField, projectColumn, type SqlEngine, type SqlSourceOptions } from './sources/sql-source'
export { createDuckDbWasmEngine, plainValue, type DuckDbWasmOptions, type FileSqlEngine } from './sources/duckdb-wasm'
export { HttpSource, createHttpSource, fetchTransport, type CatalogResponse, type FetchTransportOptions, type StudioTransport } from './sources/http'

// Executors and helpers
export { filterToSql, isEmptyFilter, quoteIdent, quoteLiteral, type ColumnTypes, type CompileOptions } from './lib/sql-compile'
export { aggregateRows, binEdges, filterRows, histogramRows, inferFields, profileRows, quantile, sampleRows, sortRows } from './lib/rows'
export { viewToIbis, viewToPandas, viewToSql, type ViewChart, type ViewCodeInput } from './lib/view-code'
export { assignRole, chartForField, isCategorical, CATEGORY_LIMIT, type FieldRole } from './lib/presets'
export { buildProvenance, readSvgProvenance, svgWithProvenance, type Provenance } from './lib/provenance'
export { effectiveFilter } from './lib/filters'
