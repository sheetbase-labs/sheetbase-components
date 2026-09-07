import 'sheetbase-shared/theme.css'
import 'sheetbase-shared/shell.css'
import './styles.css'
import './ux-overrides.css'
import './explorer-v2.css'
import './explorer-v3.css'
import './explorer-interactions.css'

export { App, type AppProps } from './App'
export type {
  AggregateKind, BarLayout, ChartKind, ChartSpec, ColumnKind, ColumnMeta,
  DataAdapter, DataRow, Dataset, ErrorMode, FilterLogic, FilterOperator,
  FilterRule, PaletteKind, SavedExploration,
} from './lib/types'
export { sampleAdapter } from './lib/adapters/sample'
export { datasetFromFile } from './lib/adapters/file'
export { inferColumns } from './lib/schema'
export {
  CURRENT_EXPLORATION_VERSION, createHttpExplorerAdapter,
  createLocalStorageExplorerAdapter, decodeShareHash, defaultExplorerAdapter,
  encodeShareHash, EXPLORER_STORAGE_KEY, isChartSpec, loadInitialExplorerState,
  migrateExplorerState, normaliseExplorerState, registerExplorerMigration,
  useIdleExplorerSave, type ExplorerMigration, type ExplorerPersistenceAdapter,
  type PersistedExplorerState,
} from './lib/persistence'
export { downloadText, exportChartPng, serializeChartSvg, specJson } from './lib/export'
export { runSql, runSqlAsync } from './lib/sql'
export { buildChart } from './lib/chart'
export { filteredRows, preparedRows, replicateSummary } from './lib/explore'
