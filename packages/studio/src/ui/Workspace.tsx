import type React from 'react'
import { LAYOUTS, layoutModeFor } from './layouts'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AdvancedSearch } from '@sheetbase-labs/sheetbase-advanced-search'
import { App as Explorer, defaultChartSpec, serializeChartSvg, downloadText, type ChartSpec } from '@sheetbase-labs/sheetbase-explorer'
import {
  PaneLayout,
  andCondition,
  createLocalStorageAdapter,
  emptyCondition,
  emptyView,
  loadInitialState,
  pruneViewToFields,
  toDatasetQuery,
  useIdleSave,
  useWorkbench,
  withoutCondition,
  workspaceSourceFor,
  type AnalysisView,
  type ConditionNode,
  type FieldProfile,
  type PaneLayoutState,
  type PaneSpec,
  type ResolvedTheme,
  type SheetbaseField,
  type StudioDataSource,
  type TableInfo,
  type ThemeMode,
} from '@sheetbase-labs/sheetbase-shared'
import { PagedSpreadsheet, TableSurface, createMemoryPagedAdapter, type Scalar } from '@sheetbase-labs/sheetbase-table'
import { isAbortError } from '../lib/filters'
import { assignRole, chartForField, type FieldRole } from '../lib/presets'
import { buildProvenance, svgWithProvenance } from '../lib/provenance'
import { profileRows } from '../lib/rows'
import { viewToSql, type ViewCodeInput } from '../lib/view-code'
import { explorerDataset, sourcePagedAdapter, type Row } from './data'
import { FieldBrowser, type ProfileScope } from './FieldBrowser'
import { SqlPane } from './SqlPane'

const PROFILE_BINS = 24
const PROFILE_TOP = 8
/** Wide tables profile this many fields per request; the rest load on demand. */
const PROFILE_FIELD_CAP = 200


/** Size of an element, tracked — decides the pane layout. */
function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export { DEFAULT_LAYOUT, LAYOUTS, NARROW_LAYOUT, SHORT_LAYOUT, layoutModeFor, type LayoutMode } from './layouts'

export interface WorkspaceProps {
  source: StudioDataSource
  table: TableInfo
  /** The source's catalog — SQL helpers and query history. */
  tables: readonly TableInfo[]
  /** Materialised rows for small tables; null keeps every operation on the source. */
  rows: readonly Row[] | null
  persistKey: string
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  onThemeChange(): void
  onRunSql(sql: string): Promise<void>
  /** The SQL editor's text, kept per source so it survives opening the result. */
  sqlDraft?: string
  onSqlDraft(sql: string): void
  onOpenTable(id: string): void
  /** Renders the frame chrome around the panes, given the live counters and actions. */
  frame(chrome: { status: ReactNode; actions: ReactNode; body: ReactNode }): ReactNode
}

/**
 * A first chart worth looking at. With rows in hand: the measurement with the
 * most distinct values, compared across the category with the fewest (2–12)
 * groups. Otherwise a histogram of the first measurement.
 */
function initialChart(fields: readonly SheetbaseField[], rows: readonly Row[] | null): { spec: ChartSpec; view: AnalysisView } {
  const base: ChartSpec = {
    ...defaultChartSpec,
    x: undefined, y: undefined, color: undefined,
    errorMode: 'none', errorLow: undefined, errorHigh: undefined,
  }
  const numeric = fields.filter((field) => field.dataType === 'number')
  if (rows?.length) {
    const sample = rows.length > 5000 ? rows.slice(0, 5000) : rows
    const distinct = (field: SheetbaseField) => new Set(sample.map((row) => String(row[field.id] ?? ''))).size
    const measure = numeric.map((field) => ({ field, n: distinct(field) })).sort((a, b) => b.n - a.n)[0]
    const category = fields
      .filter((field) => field.dataType === 'text' || field.dataType === 'boolean')
      .map((field) => ({ field, n: distinct(field) }))
      .filter((entry) => entry.n >= 2 && entry.n <= 12)
      .sort((a, b) => a.n - b.n)[0]
    if (measure && category && measure.n > 12) {
      return { spec: { ...base, kind: 'bar', x: category.field.id, y: measure.field.id, errorMode: 'sem' }, view: { ...emptyView('mean') } }
    }
    if (measure) return chartForField(measure.field, undefined, base, emptyView('none'))
  }
  const first = numeric[0] ?? fields.find((field) => field.dataType !== 'text') ?? fields[0]
  return first ? chartForField(first, undefined, base, emptyView('none')) : { spec: base, view: emptyView('none') }
}

export function Workspace(props: WorkspaceProps) {
  const { source, table, rows } = props
  const fields = table.fields
  const base = `${props.persistKey}:${source.id}:${table.id}`
  const viewKey = `${base}:view`
  const chartKey = `${base}:chart`
  const viewAdapter = useMemo(() => createLocalStorageAdapter<AnalysisView>(), [])
  const chartAdapter = useMemo(() => createLocalStorageAdapter<ChartSpec>(), [])
  const layoutAdapter = useMemo(() => createLocalStorageAdapter<PaneLayoutState>(), [])
  const [starter] = useState(() => initialChart(fields, rows))
  const remoteSource = useMemo(() => (rows ? undefined : workspaceSourceFor(source, table.id)), [rows, source, table.id])
  const wb = useWorkbench({
    fields,
    ...(rows ? { rows } : { source: remoteSource }),
    initialView: starter.view,
    persistKey: viewKey,
    adapter: viewAdapter,
  })
  const { view, setView, patchView, setQuery } = wb
  useIdleSave(viewKey, view, viewAdapter)
  // The persisted view may predate a schema change; never compile stale fields.
  useEffect(() => {
    const pruned = pruneViewToFields(view, fields)
    if (pruned !== view) setView(pruned)
  }, [view, fields, setView])
  // The table follows the compiled query; seed it from the restored view so the
  // first page is already filtered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once — the search pane re-emits on every later edit
  useEffect(() => {
    setQuery(toDatasetQuery(view.filter, view.sort ? [{ fieldId: view.sort.field, direction: view.sort.direction }] : undefined))
  }, [])

  const [spec, setSpec] = useState<ChartSpec>(() => ({ ...starter.spec, ...loadInitialState(chartKey, chartAdapter, starter.spec) }))
  useIdleSave(chartKey, spec, chartAdapter)

  // --- Profiles ---
  const [scope, setScope] = useState<ProfileScope>('filtered')
  const profileFields = useMemo(() => fields.slice(0, PROFILE_FIELD_CAP), [fields])
  const profileFilter = scope === 'filtered' ? view.filter : undefined
  const localProfiles = useMemo(() => {
    if (!rows) return null
    const profiled = scope === 'filtered' ? (wb.filteredRows ?? rows) : rows
    return {
      totalRows: profiled.length,
      profiles: new Map(profileFields.map((field) => [field.id, profileRows(profiled, field, { bins: PROFILE_BINS, top: PROFILE_TOP })])),
    }
  }, [rows, scope, wb.filteredRows, profileFields])
  const [remoteProfiles, setRemoteProfiles] = useState<{ totalRows: number; profiles: Map<string, FieldProfile> } | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileRetry, setProfileRetry] = useState(0)
  const profileKey = JSON.stringify(profileFilter ?? null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised filter; profileRetry is a manual trigger
  useEffect(() => {
    if (rows || !source.profile || !source.capabilities.profile) return
    const controller = new AbortController()
    setProfileLoading(true)
    // Debounce: typing in the filter builder shouldn't fire one profile per keystroke.
    const timer = setTimeout(() => {
      source.profile?.(table.id, { fields: profileFields.map((field) => field.id), filter: profileFilter, bins: PROFILE_BINS, top: PROFILE_TOP }, controller.signal).then(
        (response) => {
          if (controller.signal.aborted) return
          setRemoteProfiles({ totalRows: response.totalRows, profiles: new Map(response.profiles.map((profile) => [profile.field, profile])) })
          setProfileError(null)
          setProfileLoading(false)
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return
          setProfileError(error instanceof Error ? error.message : String(error))
          setProfileLoading(false)
        },
      )
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [rows, source, table.id, profileKey, profileFields, profileRetry])
  const profiles = localProfiles?.profiles ?? remoteProfiles?.profiles ?? new Map<string, FieldProfile>()
  const profiledRows = localProfiles?.totalRows ?? remoteProfiles?.totalRows ?? null

  // Distinct counts for the explorer's channel defaults: captured once so the
  // dataset identity stays stable while profiles follow the filter.
  const baselineRef = useRef<Map<string, FieldProfile> | null>(null)
  if (!baselineRef.current && profiles.size) baselineRef.current = profiles
  const baseline = baselineRef.current
  const dataset = useMemo(() => explorerDataset(source, table, rows, baseline ?? new Map()), [source, table, rows, baseline])

  // --- Matching rows (the "filtered N / M" counter) ---
  const [remoteMatching, setRemoteMatching] = useState<number | null>(null)
  const queryKey = JSON.stringify(wb.query)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised query
  useEffect(() => {
    if (rows) return
    if (scope === 'filtered' && remoteProfiles && profileKey === JSON.stringify(view.filter)) {
      setRemoteMatching(remoteProfiles.totalRows)
      return
    }
    const controller = new AbortController()
    source.page(table.id, { rowStart: 0, rowCount: 1, fieldIds: fields.slice(0, 1).map((field) => field.id), filterTree: view.filter }, controller.signal)
      .then((page) => { if (!controller.signal.aborted) setRemoteMatching(page.totalRows) }, () => undefined)
    return () => controller.abort()
  }, [rows, source, table.id, queryKey, remoteProfiles, scope])
  const matchingRows = rows ? (wb.filteredRows?.length ?? rows.length) : remoteMatching

  // --- Field actions ---
  const toggleCondition = useCallback((match: Pick<ConditionNode, 'field' | 'operator' | 'value'>) => {
    setView((current) => {
      const stripped = withoutCondition(current.filter, { field: match.field, operator: match.operator, value: match.value })
      if (stripped !== current.filter) return { ...current, filter: stripped }
      return { ...current, filter: andCondition(current.filter, { ...emptyCondition(match.field), operator: match.operator, value: match.value }) }
    })
  }, [setView])
  const applyChart = useCallback((next: { spec: ChartSpec; view: AnalysisView }) => {
    setSpec(next.spec)
    setView((current) => ({ ...current, summary: next.view.summary, groupBy: next.view.groupBy }))
  }, [setView])
  const onChart = useCallback((field: SheetbaseField) => applyChart(chartForField(field, profiles.get(field.id), spec, view)), [applyChart, profiles, spec, view])
  const onRole = useCallback((role: FieldRole, field: SheetbaseField) => applyChart(assignRole(role, field, fields, profiles, spec, view)), [applyChart, fields, profiles, spec, view])
  const roles = useMemo(() => ({ x: spec.x, y: view.summary === 'count' ? undefined : spec.y, color: spec.color ?? view.groupBy }), [spec.x, spec.y, spec.color, view.summary, view.groupBy])

  // --- Code, provenance ---
  const code = useMemo<ViewCodeInput>(() => ({
    table: table.id,
    fields,
    view,
    chart: { x: spec.x, y: spec.y, series: [spec.color, spec.facet].filter((field): field is string => Boolean(field)) },
  }), [table.id, fields, view, spec.x, spec.y, spec.color, spec.facet])
  const provenance = useCallback(() => buildProvenance({
    source, table, view, query: wb.query, chart: spec, sql: viewToSql(code), matchingRows,
  }), [source, table, view, wb.query, spec, code, matchingRows])
  const chartHost = useRef<HTMLDivElement>(null)
  const layoutHost = useRef<HTMLDivElement>(null)
  const size = useSize(layoutHost)
  const mode = size ? layoutModeFor(size.width, size.height) : null
  const [exportNote, setExportNote] = useState<string | null>(null)
  const exportSvg = useCallback(() => {
    const stage = chartHost.current?.querySelector<HTMLElement>('.chart-stage')
    const svg = stage ? serializeChartSvg(stage) : null
    if (!svg) { setExportNote('No chart to export yet.'); return }
    downloadText(`${table.label} · ${spec.kind}.svg`, svgWithProvenance(svg, provenance()), 'image/svg+xml;charset=utf-8')
    setExportNote('SVG saved with provenance.')
  }, [provenance, spec.kind, table.label])
  const exportProvenance = useCallback(() => {
    downloadText(`${table.label} · provenance.json`, JSON.stringify(provenance(), null, 2), 'application/json;charset=utf-8')
    setExportNote('Provenance saved.')
  }, [provenance, table.label])
  useEffect(() => {
    if (!exportNote) return
    const timer = setTimeout(() => setExportNote(null), 2500)
    return () => clearTimeout(timer)
  }, [exportNote])

  // --- Table ---
  const tableAdapter = useMemo(() => (rows
    ? createMemoryPagedAdapter(rows.map((values, index) => ({ recordId: String(index), values: values as Record<string, Scalar> })))
    : sourcePagedAdapter(source, table.id)), [rows, source, table.id])
  const datasetHeader = useMemo(() => ({ fields: fields.map((field, column) => ({ id: field.id, label: field.label, column, dataType: field.dataType, writable: false })) }), [fields])
  const fieldIds = useMemo(() => fields.map((field) => field.id), [fields])

  const panes: PaneSpec[] = [
    {
      id: 'fields',
      title: 'Fields',
      content: (
        <div className="sheetbase-scope sbs-pane" data-theme={props.resolvedTheme}>
          <FieldBrowser
            tableLabel={table.label}
            fields={fields}
            profiles={profiles}
            profiledRows={profiledRows}
            tableRows={table.rowCount ?? (rows ? rows.length : null)}
            matchingRows={matchingRows}
            loading={!rows && profileLoading}
            error={profileError}
            onRetry={() => setProfileRetry((n) => n + 1)}
            scope={scope}
            onScope={setScope}
            filter={view.filter}
            onToggleCondition={toggleCondition}
            onChart={onChart}
            onRole={onRole}
            roles={roles}
            canProfile={Boolean(rows) || source.capabilities.profile}
          />
        </div>
      ),
    },
    {
      id: 'chart',
      title: 'Chart',
      content: (
        <div ref={chartHost} className="sbs-chart-host">
          <Explorer dataset={dataset} view={view} onViewChange={setView} spec={spec} onSpecChange={setSpec} theme={props.theme} onThemeChange={props.onThemeChange} showPanel={false} shareUrl={false} />
        </div>
      ),
    },
    {
      id: 'filters',
      title: 'Filters',
      content: (
        <AdvancedSearch
          value={view}
          onChange={patchView}
          onDatasetQueryChange={setQuery}
          fields={fields}
          // Remote tables: no rows, so the builder shows no partial match
          // counts — the top bar reports the true total from the source.
          rows={rows ? (rows as Row[]) : undefined}
          preview={false}
          theme={props.theme}
          onThemeChange={() => props.onThemeChange()}
        />
      ),
    },
    {
      id: 'table',
      title: 'Rows',
      content: (
        <TableSurface
          theme={props.resolvedTheme}
          table={
            <PagedSpreadsheet
              key={`${source.id}:${table.id}:${rows ? 'local' : 'remote'}`}
              adapter={tableAdapter}
              datasetId={table.id}
              fieldIds={fieldIds}
              columnCount={Math.max(1, fieldIds.length)}
              stretch="last"
              query={wb.query}
              datasetHeader={datasetHeader}
              theme={props.resolvedTheme}
              readOnly
              showLoadStatus={false}
            />
          }
        />
      ),
    },
    {
      id: 'sql',
      title: 'SQL',
      content: (
        <div className="sheetbase-scope sbs-pane" data-theme={props.resolvedTheme}>
          <SqlPane
            enabled={Boolean(source.capabilities.sql && source.sql)}
            dialect={source.capabilities.sqlDialect}
            tables={props.tables}
            activeTableId={table.id}
            code={code}
            onRun={props.onRunSql}
            draft={props.sqlDraft}
            onDraft={props.onSqlDraft}
            onOpenTable={props.onOpenTable}
          />
        </div>
      ),
    },
  ]

  const status = (
    <span className="sbs-status" aria-live="polite">
      {matchingRows !== null && table.rowCount !== null && matchingRows !== table.rowCount
        ? <><b>{matchingRows.toLocaleString()}</b> of {table.rowCount.toLocaleString()} rows match</>
        : table.rowCount !== null ? <>{table.rowCount.toLocaleString()} rows</> : null}
      {!rows && <span className="sbs-badge" title="Rows stay where they are; every query runs at the source">at source</span>}
      {exportNote && <span className="sbs-flash">{exportNote}</span>}
    </span>
  )
  const actions = (
    <>
      <button type="button" className="sb-btn" onClick={exportSvg} title="Download the chart as SVG with its provenance embedded">Export chart</button>
      <button type="button" className="sb-btn" onClick={exportProvenance} title="Download the source, table, filters, chart and SQL behind this view">Provenance</button>
    </>
  )
  return (
    <>
      {props.frame({
        status,
        actions,
        body: (
          <div ref={layoutHost} className="sbs-layout-host">
            {mode !== null && (
              <PaneLayout
                key={mode}
                panes={panes}
                defaultLayout={LAYOUTS[mode]}
                persistKey={`${props.persistKey}:layout${mode === 'wide' ? '' : `:${mode}`}`}
                adapter={layoutAdapter}
                surface="shared"
                paneMenu="hover"
                theme={props.theme}
                className="sb-panes--fit sbs-panes"
              />
            )}
          </div>
        ),
      })}
    </>
  )
}

