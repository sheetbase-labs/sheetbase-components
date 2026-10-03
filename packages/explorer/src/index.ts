import 'sheetbase-shared/theme.css'
import 'sheetbase-shared/shell.css'
import './styles.css'
import './ux-overrides.css'
import './explorer-v2.css'
import './explorer-v3.css'
import './explorer-interactions.css'
import './figure.css'

export { App, type AppProps } from './App'
export { Chart, ChartGroup, FigureSvg, type ChartProps, type ChartGroupProps, type ChartGroupEntry } from './Chart'
export { FieldRolePanel, type FieldRolePanelProps, type FieldRolePanelSource } from './components/FieldRolePanel'
export {
  FIGURE_LAYOUT, FIGURE_TOKENS, axisTitle, buildFigure, buildFigureGroup, clipPolyline,
  describeFigure, figureDomain, formatValue, niceStep, niceTicks, referenceText, seriesStyle,
  type FigureAxis, type FigureBox, type FigureGroup, type FigureLegendItem, type FigureMarker,
  type FigureMarkerStyle, type FigureModel, type FigureOptions, type FigurePadding, type FigurePoint,
  type FigureReferenceLine, type FigureSeries, type FigureStackEntry, type FigureTick,
} from './lib/figure'
export {
  FIELD_ROLES, ROLE_CHIPS, chartFieldsFromDataset, fieldGlyph, fieldHint, roleOf, rolesFromSpec,
  specWithRole, type ChartField, type ChartFieldOptions, type FieldRole, type FieldRoleAssignment,
  type RoleWell,
} from './lib/roles'
export type {
  AggregateBucket, AggregateKind, AggregateQuery, AggregateResponse,
  BarLayout, ChartKind, ChartSpec, ColumnKind, ColumnMeta,
  DataAdapter, DataRow, Dataset, ErrorMode, FilterLogic, FilterOperator,
  FilterRule, PaletteKind, RemoteDatasetSource, RemotePage, RemotePageQuery,
  SavedExploration,
} from './lib/types'
export type { AnalysisView, SummaryKind } from 'sheetbase-shared'
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
