import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { andCondition, applyView, emptyCondition, emptyRoot, resolveThemeColours, useResolvedTheme, withoutCondition, type AnalysisView, type FilterOperator, type ThemeMode } from '@sheetbase-labs/sheetbase-shared'
import { DataTable } from './components/DataTable'
import { stageChartHeight } from './lib/chart-size'
import { datasetFromFile } from './lib/adapters/file'
import { binsToRows, bucketsToRows } from './lib/adapters/http'
import { sampleAdapter } from './lib/adapters/sample'
import { buildChart, describeChart } from './lib/chart'
import { ROW_ID, filteredRows } from './lib/explore'
import { filtersFromTree, treeFromFilters } from './lib/view'
import { CURRENT_EXPLORATION_VERSION, decodeShareHash, defaultExplorerAdapter, encodeShareHash, EXPLORER_STORAGE_KEY, loadInitialExplorerState, useIdleExplorerSave, type PersistedExplorerState } from './lib/persistence'
import { downloadText, exportChartPng, serializeChartSvg, specJson } from './lib/export'
import { runSqlAsync } from './lib/sql'
import { PlayIcon, ReloadIcon } from './components/icons'
import type { AggregateQuery, ChartKind, ChartSpec, DataAdapter, DataRow, Dataset, FilterRule, RemoteHistogramQuery, RemoteSampleQuery, SavedExploration } from './lib/types'
import {
  ChartStage, CommandBar, ExplorerFrame, useDatasetSwap,
} from './explorer-chrome'
import {
  BottomPanel, initialSpec, initialSql, smartKindFor, type BottomTab, type Menu,
} from './explorer-popovers'

/** Sensible starting channels for a dataset: most groupable category + first numeric. */
function channelDefaults(loaded: Dataset): Partial<ChartSpec> {
  const numeric = loaded.columns.filter((column) => column.kind === 'number')
  const categorical = loaded.columns.filter((column) => column.kind !== 'number')
  const groupable = categorical
    .filter((column) => column.uniqueCount > 1 && column.uniqueCount <= 60)
    .sort((a, b) => a.uniqueCount - b.uniqueCount)
  const x = groupable[0]?.key ?? categorical[0]?.key ?? loaded.columns[0]?.key
  const y = numeric[0]?.key ?? categorical[0]?.key
  const categoricalX = Boolean(x) && !numeric.some((column) => column.key === x)
  const numericY = Boolean(y) && numeric.some((column) => column.key === y)
  return {
    x, y, group: undefined, color: undefined, facet: undefined,
    errorMode: 'none', errorLow: undefined, errorHigh: undefined,
    filters: [], filterLogic: 'and', hiddenSeries: [], zoomX: undefined,
    ...(categoricalX && numericY ? { kind: 'bar' as const, aggregate: 'mean' as const } : { aggregate: 'none' as const }),
  }
}

/** How many raw rows the Data tab previews for a remote dataset. */
const REMOTE_PREVIEW_ROWS = 200
/** Default sample size for raw-row charts on a remote dataset. */
const REMOTE_SAMPLE_ROWS = 5000
/** Group size emitted by preparedRows and bucketsToRows — the y of a count chart. */
const COUNT_FIELD = '__sheetbaseCount'
/** Kinds that always draw raw rows, whatever the aggregate. */
const RAW_ROW_KINDS = new Set<ChartKind>(['histogram', 'box', 'violin', 'heatmap'])

type RemoteRawRequest =
  | { mode: 'bins'; query: RemoteHistogramQuery }
  | { mode: 'sample'; query: RemoteSampleQuery }

export interface AppProps {
  /** Dataset sources listed under Import. Defaults to the built-in sample. */
  sources?: DataAdapter[]
  /** Source loaded on mount. Defaults to the first source. Ignored when dataset is controlled. */
  initialSourceId?: string
  /**
   * Controlled dataset pushed by the host. Re-adopted on every identity
   * change, preserving spec and SQL; the host should memoize it. Wins over
   * sources while present.
   */
  dataset?: Dataset
  /**
   * Controlled chart spec. When provided, the explorer renders it and
   * reports edits through onSpecChange instead of owning state.
   */
  spec?: ChartSpec
  /** Receives every spec edit; the host persists it into block data. */
  onSpecChange?(spec: ChartSpec): void
  /**
   * Shared analysis view (filter tree, grouping, summary, sort, limit). When
   * provided the explorer charts through it and reports Group/Filter edits
   * through onViewChange, so a host can keep search and charts in sync.
   */
  view?: AnalysisView
  onViewChange?(view: AnalysisView): void
  /**
   * Draw the stage frame (padded surround, bordered card). Default true;
   * false renders just the explorer, e.g. inside a host surface.
   */
  frame?: boolean
  /**
   * Controlled theme. When provided the host owns it and edits are reported
   * through onThemeChange, so a parent shell can keep every pane in sync.
   * `"system"` follows the OS preference live; persisted explorer state keeps
   * storing the resolved light/dark value.
   */
  theme?: ThemeMode
  onThemeChange?(theme: 'light' | 'dark'): void
  /**
   * Fixed chart height in pixels. Unframed auto-height hosts should pass
   * this: without an independent bound, measuring the stage feeds back
   * into the rendered height and the layout grows without limit.
   */
  chartHeight?: number
  /**
   * Render the bottom data/SQL panel. Set false when the host already shows
   * the data (e.g. a table pane driven by the same workspace query); the chart
   * then fills the explorer. Default true.
   */
  showPanel?: boolean
  /**
   * Mirror the spec into the page URL (`#…`) so the address is shareable.
   * Default true; embedding hosts that own the URL pass false.
   */
  shareUrl?: boolean
  /**
   * Show the Import menu (sample sources, open a file into the chart). Default
   * true; hosts that own the data — and its filters and provenance — pass false
   * so the chart can't quietly diverge from the rest of the page.
   */
  showImport?: boolean
  /** Rows sampled for raw-row charts on remote datasets. Default 5000. */
  remoteSampleSize?: number
}
export function App(props: AppProps = {}) {
  const showPanel = props.showPanel !== false
  const baseDatasetRef = useRef<Dataset | null>(null)
  const [internalDataset, setInternalDataset] = useState<Dataset | null>(null)
  const dataset = props.dataset ?? internalDataset
  const [restored] = useState<PersistedExplorerState>(() => {
    const base = loadInitialExplorerState({ version: CURRENT_EXPLORATION_VERSION, theme: 'light', spec: initialSpec, sql: initialSql, saved: [], updatedAt: new Date().toISOString() }, defaultExplorerAdapter)
    const shared = typeof window === 'undefined' ? undefined : decodeShareHash(window.location.hash)
    return shared ? { ...base, spec: shared.spec, sql: shared.sql } : base
  })
  const [internalSpec, setInternalSpec] = useState<ChartSpec>(restored.spec)
  const spec = props.spec ?? internalSpec
  const onSpecChangeRef = useRef(props.onSpecChange)
  const controlledSpecRef = useRef(props.spec)
  const specRef = useRef(internalSpec)
  const viewRef = useRef(props.view)
  const onViewChangeRef = useRef(props.onViewChange)
  useEffect(() => {
    // Latest-ref sync for the stable setSpec below; effects run post-commit,
    // so handlers always observe committed values and render stays pure.
    onSpecChangeRef.current = props.onSpecChange
    controlledSpecRef.current = props.spec
    specRef.current = spec
    viewRef.current = props.view
    onViewChangeRef.current = props.onViewChange
  }, [props.onSpecChange, props.spec, props.view, props.onViewChange, spec])
  const setSpec = useCallback((action: SetStateAction<ChartSpec>) => {
    // Resolved outside the updater: React may replay updaters, so the parent
    // notification must not live inside one.
    const next = typeof action === 'function' ? action(specRef.current) : action
    if (controlledSpecRef.current === undefined) {
      specRef.current = next
      setInternalSpec(next)
    }
    onSpecChangeRef.current?.(next)
  }, [])
  const [sql, setSql] = useState(restored.sql)
  const [saved, setSaved] = useState<SavedExploration[]>(restored.saved)
  const [sqlError, setSqlError] = useState<string | null>(null)
  const [sqlRunning, setSqlRunning] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const shareUrl = props.shareUrl !== false
  useEffect(() => {
    if (!shareUrl) return
    try { window.history.replaceState(null, '', encodeShareHash(spec, sql)) } catch { /* Non-http contexts have no URL to share. */ }
  }, [spec, sql, shareUrl])
  const [tab, setTab] = useState<BottomTab>('data')
  const [dark, setDark] = useState(restored.theme === 'dark')
  const controlledTheme = props.theme
  const resolvedControlledTheme = useResolvedTheme(controlledTheme ?? 'light')
  const isDark = controlledTheme !== undefined ? resolvedControlledTheme === 'dark' : dark
  const showThemeToggle = controlledTheme === undefined
  const [menu, setMenu] = useState<Menu>(null)
  const [measuredHeight, setMeasuredHeight] = useState(420)
  const chartHeight = props.chartHeight ?? measuredHeight
  const [selectedRow, setSelectedRow] = useState<number | undefined>()
  type CrossFilterMatch = { field: string; operator: FilterOperator; value: unknown }
  const [crossFilter, setCrossFilter] = useState<CrossFilterMatch[] | null>(null)
  const [panelHeight, setPanelHeight] = useState(250)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [libraryName, setLibraryName] = useState('')
  const sources = useMemo<DataAdapter[]>(() => props.sources ?? [sampleAdapter], [props.sources])
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const chartStageRef = useRef<HTMLDivElement>(null)
  // The stage mounts late (after a dataset loads), so track the element
  // itself: a measuring effect keyed on a ref object would never re-run.
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null)
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    chartStageRef.current = element
    setStageElement(element)
  }, [])
  const rootRef = useRef<HTMLDivElement>(null)
  const persisted = useMemo<PersistedExplorerState>(() => ({ version: CURRENT_EXPLORATION_VERSION, theme: isDark ? 'dark' : 'light', spec, sql, saved, updatedAt: new Date().toISOString() }), [spec, sql, saved, isDark])
  useIdleExplorerSave(EXPLORER_STORAGE_KEY, persisted, defaultExplorerAdapter)
  const adoptDataset = useCallback((loaded: Dataset) => {
    baseDatasetRef.current = loaded
    setInternalDataset(loaded); setSql(initialSql); setSqlError(null); setSelectedRow(undefined)
    setSpec((current) => ({ ...current, ...channelDefaults(loaded) }))
  }, [setSpec])
  /** Back to the dataset's default chart, clearing any shared view filters. */
  const resetChart = useCallback(() => {
    setSpec((current) => ({ ...current, ...(dataset ? channelDefaults(dataset) : initialSpec) }))
    setSelectedRow(undefined)
    setSql(initialSql)
    setSqlError(null)
    if (viewRef.current && onViewChangeRef.current) {
      onViewChangeRef.current({ ...viewRef.current, filter: emptyRoot(), groupBy: undefined, sort: undefined, limit: undefined })
    }
  }, [dataset, setSpec])
  const didInitialLoadRef = useRef(false)
  useEffect(() => {
    if (props.dataset || didInitialLoadRef.current) return
    didInitialLoadRef.current = true
    const first = sources.find((source) => source.id === props.initialSourceId) ?? sources[0]
    if (!first) return
    first.load().then(adoptDataset, (error: unknown) => setSqlError(error instanceof Error ? error.message : String(error)))
  }, [props.dataset, props.initialSourceId, sources, adoptDataset])
  const datasetSwapped = useDatasetSwap(dataset)
  if (datasetSwapped) {
    if (selectedRow !== undefined) setSelectedRow(undefined)
    if (crossFilter !== null) setCrossFilter(null)
    if (spec.zoomX !== undefined && props.spec === undefined) setInternalSpec({ ...spec, zoomX: undefined })
  }

  // A host-supplied dataset may not contain the columns the spec was last
  // pointed at. When it doesn't, pick a readable default: the most groupable
  // categorical column for x and the first numeric column for y.
  const datasetColumnsKey = dataset
    ? dataset.columns.map((column) => `${column.key}:${column.kind}:${column.uniqueCount}`).join('\u0000')
    : ''
  // Reconcile only when the dataset's columns change, not on every spec edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on datasetColumnsKey deliberately — spec edits must not retrigger reconciliation.
  useEffect(() => {
    if (!dataset) return
    const columns = dataset.columns
    const valid = (key: string | undefined) => key === undefined || columns.some((column) => column.key === key)
    // Chart filters are dataset-relative too — rules on columns the new
    // dataset doesn't have would compile into remote requests as dead fields.
    const pruneFilters = (filters: FilterRule[] | undefined) => filters?.filter((rule) => valid(rule.field))
    const filtersStale = (current: ChartSpec) => current.filters?.some((rule) => !valid(rule.field)) ?? false
    if (valid(spec.x) && valid(spec.y)) {
      // x/y are fine; still drop any stale channel references from another dataset.
      const stale = !valid(spec.group) || !valid(spec.color) || !valid(spec.facet) || !valid(spec.errorLow) || !valid(spec.errorHigh) || !valid(spec.excludeField) || filtersStale(spec)
      if (!stale) return
      setSpec((current) => ({
        ...current,
        ...(valid(current.group) ? {} : { group: undefined }),
        ...(valid(current.color) ? {} : { color: undefined }),
        ...(valid(current.facet) ? {} : { facet: undefined }),
        ...(valid(current.errorLow) ? {} : { errorLow: undefined }),
        ...(valid(current.errorHigh) ? {} : { errorHigh: undefined }),
        ...(valid(current.excludeField) ? {} : { excludeField: undefined }),
        ...(valid(current.errorLow) && valid(current.errorHigh) ? {} : { errorMode: current.errorMode === 'explicit' ? 'none' as const : current.errorMode }),
        ...(filtersStale(current) ? { filters: pruneFilters(current.filters) } : {}),
      }))
      return
    }
    const numeric = columns.filter((column) => column.kind === 'number')
    const categorical = columns.filter((column) => column.kind !== 'number')
    const groupable = categorical
      .filter((column) => column.uniqueCount > 1 && column.uniqueCount <= 60)
      .sort((a, b) => a.uniqueCount - b.uniqueCount)
    const x = valid(spec.x) ? spec.x : (groupable[0]?.key ?? categorical[0]?.key ?? columns[0]?.key)
    const y = valid(spec.y) ? spec.y : (numeric[0]?.key ?? categorical[0]?.key ?? columns[0]?.key)
    const categoricalX = columns.some((column) => column.key === x && column.kind !== 'number')
    const numericY = columns.some((column) => column.key === y && column.kind === 'number')
    const switchToBar = categoricalX && numericY && (spec.kind === 'scatter' || spec.kind === 'line' || spec.kind === 'area')
    setSpec((current) => ({
      ...current,
      x,
      y,
      ...(switchToBar ? { kind: 'bar' as const, aggregate: current.aggregate === 'none' ? 'mean' as const : current.aggregate } : {}),
      ...(valid(current.group) ? {} : { group: undefined }),
      ...(valid(current.color) ? {} : { color: undefined }),
      ...(valid(current.facet) ? {} : { facet: undefined }),
      ...(valid(current.errorLow) ? {} : { errorLow: undefined }),
      ...(valid(current.errorHigh) ? {} : { errorHigh: undefined }),
      ...(valid(current.excludeField) ? {} : { excludeField: undefined }),
      ...(valid(current.errorLow) && valid(current.errorHigh) ? {} : { errorMode: current.errorMode === 'explicit' ? 'none' as const : current.errorMode }),
      ...(filtersStale(current) ? { filters: pruneFilters(current.filters) } : {}),
    }))
  }, [datasetColumnsKey])

  const [themeEpoch, setThemeEpoch] = useState(0)
  // The root's data-theme must be set before the chart reads the themed colour
  // variables, so apply it in a layout effect and bump an epoch to re-resolve.
  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.dataset.theme = isDark ? 'dark' : 'light'
    setThemeEpoch((epoch) => epoch + 1)
  }, [isDark])
  // The chart draws at exactly the box its SVG is stretched to fill — the
  // stage's content height — so it never scales its text or letterboxes.
  useEffect(() => {
    if (props.frame === false && props.chartHeight === undefined) return
    const stage = stageElement
    if (!stage) return
    const resize = () => {
      const style = getComputedStyle(stage)
      setMeasuredHeight(stageChartHeight(stage.clientHeight, Number.parseFloat(style.paddingTop), Number.parseFloat(style.paddingBottom)))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stageElement, props.frame, props.chartHeight])

  // The shared analysis view, when the host provides one, overrides the
  // spec's filters/group/summary and adds sort/limit to the row pipeline.
  const view = props.view
  const viewFilters = useMemo(() => (view ? filtersFromTree(view.filter) : null), [view])
  // A view whose tree can't flatten (NOT / mixed nesting) is still applied to
  // the rows through viewRows below — chartSpec then carries no flat rules so
  // the rows are not filtered a second time by a corrupted list.
  const chartSpec = useMemo<ChartSpec>(() => (view
    ? { ...spec, filters: viewFilters?.rules ?? [], filterLogic: viewFilters?.logic ?? 'and', group: view.groupBy, aggregate: view.summary }
    : spec), [spec, view, viewFilters])
  const chartSpecRef = useRef(chartSpec)
  useEffect(() => { chartSpecRef.current = chartSpec }, [chartSpec])
  /** Route Group/Filter edits through the view when the host controls one. */
  const setAnalysisSpec = useCallback((action: SetStateAction<ChartSpec>) => {
    const current = chartSpecRef.current
    const next = typeof action === 'function' ? action(current) : action
    if (!viewRef.current) { setSpec(next); return }
    const stylePatch: Partial<ChartSpec> = {}
    if (next.showRawPoints !== current.showRawPoints) stylePatch.showRawPoints = next.showRawPoints
    if (next.hiddenSeries !== current.hiddenSeries) stylePatch.hiddenSeries = next.hiddenSeries
    if (Object.keys(stylePatch).length) setSpec((prev) => ({ ...prev, ...stylePatch }))
    // Editing filters in the explorer deliberately replaces the view's filter
    // tree — including any nested/NOT structure the flat list cannot express —
    // with the flat rules just edited.
    onViewChangeRef.current?.({
      ...viewRef.current,
      filter: treeFromFilters(next.filters ?? [], next.filterLogic ?? 'and'),
      groupBy: next.group,
      summary: next.aggregate,
    })
  }, [setSpec])
  /**
   * Chart-mark click: toggles row selection, and when a shared view is
   * attached ANDs the clicked bucket's dimension values into `view.filter`
   * as ordinary eq conditions (x, plus the series field group ?? color when
   * the datum carries it). Clicking the same mark again removes them.
   */
  const onSelectChartMark = useCallback((index: number, datum: Record<string, unknown>) => {
    setSelectedRow((current) => current === index ? undefined : index)
    const currentView = viewRef.current
    const emit = onViewChangeRef.current
    const x = chartSpecRef.current.x
    if (!currentView || !emit || !x || !(x in datum)) return
    const matches: CrossFilterMatch[] = [{ field: x, operator: 'eq', value: String(datum[x]) }]
    const seriesField = chartSpecRef.current.group ?? chartSpecRef.current.color
    if (seriesField && seriesField in datum) {
      matches.push({ field: seriesField, operator: 'eq', value: String(datum[seriesField]) })
    }
    const stripped = matches.reduce((root, match) => withoutCondition(root, match), currentView.filter)
    if (stripped !== currentView.filter) {
      setCrossFilter(null)
      emit({ ...currentView, filter: stripped })
      return
    }
    const next = matches.reduce(
      (root, match) => andCondition(root, { ...emptyCondition(match.field), operator: match.operator, value: match.value }),
      currentView.filter,
    )
    setCrossFilter(matches)
    emit({ ...currentView, filter: next })
  }, [])
  const crossFilterActive = Boolean(view && crossFilter?.some((match) => withoutCondition(view.filter, match) !== view.filter))
  const clearCrossFilter = useCallback(() => {
    const currentView = viewRef.current
    if (currentView && onViewChangeRef.current && crossFilter) {
      onViewChangeRef.current({
        ...currentView,
        filter: crossFilter.reduce((root, match) => withoutCondition(root, match), currentView.filter),
      })
    }
    setCrossFilter(null)
  }, [crossFilter])
  const viewRows = useMemo<DataRow[] | null>(() => (view && dataset ? applyView(dataset.rows, view) : null), [view, dataset])

  // Remote datasets keep their rows server-side: `dataset.remote.aggregate`
  // groups+sums on the server and the chart draws the returned buckets. Only
  // specs whose preparedRows step would aggregate go remote — histogram,
  // box, violin and heatmap always draw raw rows, and an aggregate of
  // 'none' needs them too.
  const remote = dataset?.remote
  const remoteQuery = useMemo<AggregateQuery | null>(() => {
    if (!remote || !chartSpec.x || chartSpec.aggregate === 'none') return null
    if (chartSpec.kind === 'histogram' || chartSpec.kind === 'box' || chartSpec.kind === 'violin' || chartSpec.kind === 'heatmap') return null
    if (chartSpec.aggregate !== 'count' && !chartSpec.y) return null
    return {
      // The shared view's tree goes over the wire intact; flat spec filters
      // are rebuilt into one. Either way the server applies it once.
      filter: view?.filter ?? treeFromFilters(chartSpec.filters ?? [], chartSpec.filterLogic ?? 'and'),
      groupBy: chartSpec.x,
      seriesBy: [chartSpec.group, chartSpec.color, chartSpec.facet]
        .filter((field): field is string => Boolean(field) && field !== chartSpec.x)
        .filter((field, index, all) => all.indexOf(field) === index),
      summary: chartSpec.aggregate,
      valueField: chartSpec.aggregate === 'count' ? undefined : chartSpec.y,
      limit: view?.limit,
    }
  }, [remote, chartSpec.x, chartSpec.y, chartSpec.group, chartSpec.color, chartSpec.facet, chartSpec.aggregate, chartSpec.kind, chartSpec.filters, chartSpec.filterLogic, view])
  const [remoteResult, setRemoteResult] = useState<{ dataset: Dataset; rows: DataRow[]; totalRows: number } | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [remoteRetry, setRemoteRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: remoteRetry is a manual re-fetch trigger bumped by the retry UI
  useEffect(() => {
    if (!remote || !remoteQuery || !dataset) return
    const controller = new AbortController()
    remote.aggregate(remoteQuery, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return
        setRemoteResult({ dataset, rows: bucketsToRows(response.buckets, remoteQuery), totalRows: response.totalRows })
        setRemoteError(null)
      },
      (error: unknown) => {
        if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return
        setRemoteError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => controller.abort()
  }, [remote, remoteQuery, dataset, remoteRetry])

  // First-page preview for the Data tab — only fetched when the remote
  // capability exists, and re-fetched when the shared view's filter changes.
  const [remotePage, setRemotePage] = useState<{ dataset: Dataset; rows: DataRow[]; totalRows: number } | null>(null)
  const [remotePageError, setRemotePageError] = useState<string | null>(null)
  const [remotePageRetry, setRemotePageRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: remotePageRetry is a manual re-fetch trigger bumped by the retry UI
  useEffect(() => {
    if (!remote?.page || !dataset) return
    const controller = new AbortController()
    remote.page({ offset: 0, limit: REMOTE_PREVIEW_ROWS, fields: dataset.columns.map((column) => column.key), filter: view?.filter }, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setRemotePage({ dataset, rows: page.rows, totalRows: page.totalRows })
        setRemotePageError(null)
      },
      (error: unknown) => {
        if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return
        setRemotePageError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => controller.abort()
  }, [remote, dataset, view, remotePageRetry])
  const remotePageRows = remotePage?.dataset === dataset ? remotePage.rows : null
  const remoteAggregateRows = remoteResult?.dataset === dataset ? remoteResult.rows : null

  // Raw-row specs on a remote dataset: exact server bins for a histogram when
  // the source can bin, otherwise a labelled random sample when it can
  // sample. Without either, the chart keeps its "pick an aggregate" note.
  const sampleSize = props.remoteSampleSize ?? REMOTE_SAMPLE_ROWS
  const rawKey = useMemo<string | null>(() => {
    if (!remote || remoteQuery || !chartSpec.x || !dataset) return null
    const filter = view?.filter ?? treeFromFilters(chartSpec.filters ?? [], chartSpec.filterLogic ?? 'and')
    const known = new Set(dataset.columns.map((column) => column.key))
    const xKind = dataset.columns.find((column) => column.key === chartSpec.x)?.kind
    let request: RemoteRawRequest | null = null
    if (chartSpec.kind === 'histogram' && remote.histogram && xKind === 'number') {
      const by = chartSpec.color ?? chartSpec.group
      request = { mode: 'bins', query: {
        field: chartSpec.x,
        bins: Math.max(3, Math.round(chartSpec.histogramBins)),
        ...(chartSpec.histogramBinWidth ? { binWidth: chartSpec.histogramBinWidth } : {}),
        ...(by && known.has(by) ? { by } : {}),
        filter,
      } }
    } else if (remote.sample) {
      const fields = [chartSpec.x, chartSpec.y, chartSpec.group, chartSpec.color, chartSpec.facet, chartSpec.size, chartSpec.errorLow, chartSpec.errorHigh, chartSpec.labelField, chartSpec.excludeField, chartSpec.y2]
        .filter((field): field is string => Boolean(field) && known.has(field as string))
        .filter((field, index, all) => all.indexOf(field) === index)
      request = { mode: 'sample', query: { fields, n: sampleSize, filter } }
    }
    return request ? JSON.stringify(request) : null
  }, [remote, remoteQuery, dataset, view, sampleSize, chartSpec.x, chartSpec.y, chartSpec.group, chartSpec.color, chartSpec.facet, chartSpec.size, chartSpec.errorLow, chartSpec.errorHigh, chartSpec.labelField, chartSpec.excludeField, chartSpec.y2, chartSpec.kind, chartSpec.histogramBins, chartSpec.histogramBinWidth, chartSpec.filters, chartSpec.filterLogic])
  const [remoteRaw, setRemoteRaw] = useState<{ dataset: Dataset; key: string; mode: 'bins' | 'sample'; rows: DataRow[]; totalRows: number; sampled: boolean } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: remoteRetry is a manual re-fetch trigger bumped by the retry UI
  useEffect(() => {
    if (!remote || !rawKey || !dataset) return
    const request = JSON.parse(rawKey) as RemoteRawRequest
    const controller = new AbortController()
    const run = request.mode === 'bins' && remote.histogram
      ? remote.histogram(request.query, controller.signal).then((histogram) => ({ rows: binsToRows(histogram, request.query.by), totalRows: histogram.totalRows, sampled: false }))
      : request.mode === 'sample' && remote.sample
        ? remote.sample(request.query, controller.signal).then((sample) => ({ rows: sample.rows.map((row, index) => ({ ...row, [ROW_ID]: index })), totalRows: sample.totalRows, sampled: sample.sampled }))
        : null
    if (!run) return
    run.then(
      (result) => {
        if (controller.signal.aborted) return
        setRemoteRaw({ dataset, key: rawKey, mode: request.mode, ...result })
        setRemoteError(null)
      },
      (error: unknown) => {
        if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return
        setRemoteError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => controller.abort()
  }, [remote, rawKey, dataset, remoteRetry])
  const remoteRawCurrent = remoteRaw && remoteRaw.dataset === dataset && remoteRaw.key === rawKey ? remoteRaw : null
  const remoteRows = remoteQuery ? remoteAggregateRows : rawKey ? (remoteRawCurrent?.rows ?? null) : null

  // A count needs no measure: both the client-side aggregate and server
  // buckets carry the group size under COUNT_FIELD, so count charts plot that
  // synthetic numeric column instead of whatever y happens to be.
  const countChart = chartSpec.aggregate === 'count' && !RAW_ROW_KINDS.has(chartSpec.kind)
  const chartDataset = useMemo<Dataset | null>(() => {
    if (!dataset) return null
    const base = remote ? { ...dataset, rows: remoteRows ?? [] } : viewRows ? { ...dataset, rows: viewRows } : dataset
    return countChart && !base.columns.some((column) => column.key === COUNT_FIELD)
      ? { ...base, columns: [...base.columns, { key: COUNT_FIELD, kind: 'number', nullable: false, uniqueCount: 0 }] }
      : base
  }, [dataset, remote, remoteRows, viewRows, countChart])

  // Bucket rows are already filtered and aggregated: build the chart with a
  // pass-through spec so preparedRows/filteredRows don't re-apply either.
  // Sampled raw rows were filtered on the server but are otherwise raw, so
  // only the filters are dropped.
  const chartSpecForBuild = useMemo<ChartSpec>(() => {
    const counted = countChart ? { ...chartSpec, y: COUNT_FIELD, yLabel: chartSpec.yLabel || 'Count', errorMode: 'none' as const } : chartSpec
    if (!remote) return counted
    return remoteQuery
      ? { ...counted, aggregate: 'none', filters: [], filterLogic: 'and', errorMode: 'none' }
      : { ...counted, filters: [], filterLogic: 'and' }
  }, [remote, remoteQuery, chartSpec, countChart])

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeEpoch re-reads the palette after the root's data-theme is applied
  const chartPalette = useMemo(() => resolveThemeColours(chartSpec.palette, rootRef.current ?? undefined), [chartSpec.palette, themeEpoch])

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeEpoch rebuilds the chart after the root's data-theme is applied
  const definition = useMemo(() => {
    if (!chartDataset) return null
    if (remote && remoteRows === null) return null
    return buildChart(chartDataset, chartSpecForBuild, selectedRow, (window) => setSpec((current) => ({ ...current, zoomX: window })))
  }, [chartDataset, chartSpecForBuild, remote, remoteRows, selectedRow, setSpec, themeEpoch])
  const visibleRows = useMemo(() => {
    if (!chartDataset) return []
    if (remote) return remoteRows ?? []
    return filteredRows(chartDataset, chartSpec)
  }, [chartDataset, chartSpec, remote, remoteRows])
  const remoteState = !remote ? null
    : remoteError ? 'error' as const
    : !remoteQuery && !rawKey ? 'raw' as const
    : remoteRows === null ? 'loading' as const
    : null
  const seriesField = chartSpec.color ?? chartSpec.group
  const hiddenSeries = useMemo(() => new Set(chartSpec.hiddenSeries ?? []), [chartSpec.hiddenSeries])
  const seriesValues = useMemo(() => {
    if (!chartDataset || !seriesField) return []
    const seen = new Set<string>()
    const values: string[] = []
    for (const row of visibleRows) {
      const value = String(row[seriesField] ?? '')
      if (!value || seen.has(value)) continue
      seen.add(value)
      values.push(value)
    }
    return values
  }, [seriesField, visibleRows, chartDataset])

  async function openFile(file?: File) {
    if (!file) return
    try { adoptDataset(await datasetFromFile(file)) }
    catch (error) { setSqlError(error instanceof Error ? error.message : String(error)) }
  }
  async function loadSource(id: string) {
    const source = sources.find((item) => item.id === id)
    if (!source) return
    setImportStatus(`Loading ${source.label}…`)
    try { adoptDataset(await source.load()); setMenu(null); setImportStatus(null) }
    catch (error) { setImportStatus(error instanceof Error ? error.message : String(error)) }
  }

  function saveCurrentExploration() {
    const name = libraryName.trim()

  if (!name) return
    const now = new Date().toISOString()
    setSaved((current) => [{ id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, spec, sql }, ...current])
    setLibraryName('')
  }

  function loadExploration(id: string) {
    const entry = saved.find((item) => item.id === id)
    if (!entry) return
    setSpec({ ...entry.spec }); setSql(entry.sql); setMenu(null)
  }

  function deleteExploration(id: string) {
    setSaved((current) => current.filter((entry) => entry.id !== id))
  }

  async function executeSql() {
    const base = baseDatasetRef.current
    if (!base || sqlRunning) return
    setSqlRunning(true)
    try {
      const result = await runSqlAsync(base, sql)
      // A dataset loaded mid-flight owns the pane now — the stale result and
      // its error state must not overwrite it.
      if (baseDatasetRef.current !== base) return
      setInternalDataset(result); setSqlError(null); setTab('data'); setSelectedRow(undefined); setSpec((current) => ({ ...current, zoomX: undefined }))
    }
    catch (error) { if (baseDatasetRef.current === base) setSqlError(error instanceof Error ? error.message : String(error)) }
    finally { setSqlRunning(false) }
  }
  function resetSql() { setSql(initialSql); setInternalDataset(baseDatasetRef.current); setSqlError(null); setSpec((current) => ({ ...current, zoomX: undefined })) }
  function flashExportStatus(message: string) { setExportStatus(message); setTimeout(() => setExportStatus((current) => current === message ? null : current), 2500) }
  function exportSvgFile() {
    const stage = chartStageRef.current
    if (!stage) return
    const serialized = serializeChartSvg(stage)
    if (!serialized) { flashExportStatus('No chart to export yet.'); return }
    downloadText(`${dataset?.name ?? 'chart'} · ${spec.kind}.svg`, serialized, 'image/svg+xml;charset=utf-8')
    flashExportStatus('SVG downloaded.')
  }
  async function exportPngFile() {
    const stage = chartStageRef.current
    if (!stage) return
    try { await exportChartPng(stage, `${dataset?.name ?? 'chart'} · ${spec.kind}.png`); flashExportStatus('PNG downloaded.') }
    catch (error) { flashExportStatus(error instanceof Error ? error.message : String(error)) }
  }
  async function copySpecJson() {
    try { await navigator.clipboard.writeText(specJson(spec, sql)); flashExportStatus('Spec copied.') }
    catch { flashExportStatus('Clipboard unavailable.') }
  }
  async function copyShareLink() {
    const hash = encodeShareHash(spec, sql)
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${hash}`); window.history.replaceState(null, '', hash); flashExportStatus('Link copied.') }
    catch { flashExportStatus('Clipboard unavailable.') }
  }


  function setField(role: 'x' | 'y' | 'color' | 'facet', value?: string) {
    setSpec((current) => {
      const next: ChartSpec = { ...current, [role]: value, hiddenSeries: role === 'color' ? [] : current.hiddenSeries, zoomX: role === 'x' ? undefined : current.zoomX }
      if (role === 'x' || role === 'y') {
        const inferred = smartKindFor(dataset, role === 'x' ? value : next.x, role === 'y' ? value : next.y)
        if (inferred) next.kind = inferred
      }
      return next
    })
  }

  function choosePlot(kind: ChartKind) {
    setSpec((current) => ({ ...current, kind, aggregate: ['bar', 'horizontal-bar', 'area'].includes(kind) && current.aggregate === 'none' ? 'mean' : current.aggregate, barLayout: ['bar', 'horizontal-bar'].includes(kind) ? 'grouped' : current.barLayout }))
    setMenu(null)
  }



  function toggleSeries(value: string, isolate = false) {
    setSpec((current) => {
      const hidden = new Set(current.hiddenSeries ?? [])
      if (isolate) {
        const all = seriesValues
        const alreadyIsolated = all.every((item) => item === value || hidden.has(item))
        return { ...current, hiddenSeries: alreadyIsolated ? [] : all.filter((item) => item !== value) }
      }
      hidden.has(value) ? hidden.delete(value) : hidden.add(value)
      return { ...current, hiddenSeries: [...hidden] }
    })
  }

  function startResize(event: ReactPointerEvent) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight
    const move = (moveEvent: globalThis.PointerEvent) => setPanelHeight(Math.max(120, Math.min(560, startHeight + startY - moveEvent.clientY)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  function resizeBy(delta: number) {
    setPanelHeight((height) => Math.max(120, Math.min(560, height + delta)))
  }

  function toggleDark() {
    const next = !isDark
    if (controlledTheme === undefined) setDark(next)
    props.onThemeChange?.(next ? 'dark' : 'light')
  }

  if (!dataset) return <div className="loading">Loading Explorer…</div>

  const remoteTable = !remote?.page ? null
    : remotePageError
      ? <div className="remote-note">Row preview failed: {remotePageError}{' '}<button type="button" className="sb-btn subtle" onClick={() => setRemotePageRetry((n) => n + 1)}>Retry</button></div>
      : remotePageRows === null
        ? <div className="remote-note"><span className="sb-spinner" aria-hidden="true" /> Fetching the first {REMOTE_PREVIEW_ROWS.toLocaleString()} rows…</div>
        : <div className="remote-preview">
            <div className="remote-note remote-note--strip">Showing the first {remotePageRows.length.toLocaleString()} of {(remotePage?.totalRows ?? 0).toLocaleString()} rows — the rest stay on the server.</div>
            <DataTable dataset={dataset} rows={remotePageRows} />
          </div>

  const body = (<>
    <main className="workspace explorer-workspace-v3"><section className="canvas-region explorer-canvas-v3">
    <CommandBar showImport={props.showImport !== false} menu={menu} spec={chartSpec} dataset={dataset} sources={sources} saved={saved} libraryName={libraryName} exportStatus={exportStatus} importStatus={importStatus} dark={isDark} showThemeToggle={showThemeToggle} setSpec={setSpec} onAnalysisSpec={setAnalysisSpec} viewFilterLocked={view !== undefined && viewFilters === undefined} onReset={resetChart} onField={setField} onChoosePlot={choosePlot} onExportSvg={exportSvgFile} onExportPng={exportPngFile} onCopySpec={copySpecJson} onCopyLink={copyShareLink} onSaveExploration={saveCurrentExploration} onLoadExploration={loadExploration} onDeleteExploration={deleteExploration} onLibraryName={setLibraryName} onLoadSource={loadSource} onOpenFile={openFile} onMenuToggle={(id) => setMenu((current) => current === id ? null : id)} onMenuClose={() => setMenu(null)} onToggleDark={toggleDark} />
    {remoteRawCurrent?.sampled && !remoteState && (
      <div className="remote-note remote-note--strip">Drawn from a random sample of {remoteRawCurrent.rows.length.toLocaleString()} of {remoteRawCurrent.totalRows.toLocaleString()} matching rows. Aggregated charts and histograms use every row.</div>
    )}
    {crossFilterActive && crossFilter && (
      <div className="remote-note remote-note--strip">Cross-filtered by {crossFilter.map((match) => `${match.field} = ${String(match.value)}`).join(', ')}
        <button type="button" className="sb-btn" onClick={clearCrossFilter}>Clear</button>
      </div>
    )}
    {remoteState
      ? <div className="chart-stage chart-stage-v3"><div className="empty-state"><strong>Remote source</strong>
          {remoteState === 'error'
            ? <><span>Aggregation failed: {remoteError}</span><button type="button" className="sb-btn" onClick={() => { setRemoteError(null); setRemoteRetry((n) => n + 1) }}>Retry</button></>
            : remoteState === 'raw'
              ? <span>Raw rows stay on the server for this source — pick an aggregate (sum, mean, count, …) with a bar, pie, line or similar chart. Scatter, histogram, box, violin and heatmap need raw rows.</span>
              : <><span className="sb-spinner" aria-hidden="true" /><span>{remoteQuery ? 'Aggregating on the server…' : chartSpec.kind === 'histogram' && remote?.histogram ? 'Binning on the server…' : 'Sampling rows on the server…'}</span></>}
        </div></div>
      : <ChartStage stageRef={attachStage} seriesValues={seriesValues} palette={chartPalette} hiddenSeries={hiddenSeries} onToggleSeries={toggleSeries} definition={definition} chartHeight={chartHeight} chartLabel={describeChart(chartSpec, visibleRows.length)} onSelectRowId={onSelectChartMark} />}
    {!showPanel && (
      <details className="explorer-data-disclosure">
        <summary>Data table ({visibleRows.length.toLocaleString()} rows)</summary>
        {remote
          ? remoteTable ?? <div className="remote-note">Rows live on the server for this source — the chart above shows aggregated buckets.</div>
          : <DataTable dataset={dataset} rows={visibleRows} selectedRow={selectedRow} onSelectRow={(index) => setSelectedRow((current) => current === index ? undefined : index)}/>}
      </details>
    )}
  </section></main>
  {showPanel && <BottomPanel tab={tab} onTab={(next) => { setTab(next); setPanelCollapsed(false) }} collapsed={panelCollapsed} onToggleCollapsed={() => setPanelCollapsed((value) => !value)} visibleCount={remote && tab === 'data' && remotePageRows ? remotePageRows.length : visibleRows.length} totalCount={remote ? (remotePage?.totalRows ?? remoteResult?.totalRows ?? remoteRawCurrent?.totalRows ?? 0) : dataset.rows.length} panelHeight={panelHeight} onResizeStart={startResize} onResizeStep={resizeBy}>{remote ? (tab === 'data' ? remoteTable ?? <div className="remote-note">Rows live on the server for this source — the chart above shows aggregated buckets.</div> : <div className="remote-note">SQL runs against rows in the browser; remote datasets stay on the server.</div>) : tab === 'data' ? <DataTable dataset={dataset} rows={visibleRows} selectedRow={selectedRow} onSelectRow={(index) => setSelectedRow((current) => current === index ? undefined : index)}/> : <div className="sql-workspace"><div className="sql-header"><span>Query the loaded data using <code>?</code> as the source table.</span><div><button type="button" className="sb-btn subtle" onClick={resetSql}><ReloadIcon size={13}/>Reset</button><button type="button" className="button primary" onClick={executeSql} disabled={sqlRunning}>{sqlRunning ? 'Running…' : <><PlayIcon size={13}/>Run query</>}</button></div></div><textarea aria-label="SQL query" spellCheck={false} value={sql} onChange={(event) => setSql(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') executeSql() }}/>{sqlError && <div className="sql-error">{sqlError}</div>}</div>}</BottomPanel>}
  </>)
  return <ExplorerFrame framed={props.frame} rootRef={rootRef} panel={showPanel} panelCollapsed={panelCollapsed} panelHeight={panelHeight}>{body}</ExplorerFrame>
}
