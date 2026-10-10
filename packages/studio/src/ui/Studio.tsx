import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  SheetbaseShell,
  createLocalStorageAdapter,
  loadInitialState,
  useIdleSave,
  usePersistedTheme,
  type StudioDataSource,
  type TableInfo,
  type ThemeMode,
} from '@sheetbase-labs/sheetbase-shared'
import { isAbortError } from '../lib/filters'
import type { DuckDbWasmOptions } from '../sources/duckdb-wasm'
import { ACCEPTED_FILE_TYPES } from '../sources/file'
import { MemorySource } from '../sources/memory'
import { loadAllRows, type Row } from './data'
import { MoreMenu } from './MoreMenu'
import { Workspace } from './Workspace'

export interface TableRef {
  sourceId: string
  tableId: string
}

export interface SheetbaseStudioProps {
  /** Where data comes from: host rows, files, an HTTP API, a Python backend… */
  sources?: StudioDataSource | readonly StudioDataSource[]
  /** Table to open first. Defaults to the last one opened, else the first. */
  initialTable?: TableRef | string
  /**
   * Tables with at most this many rows are pulled into the browser once and
   * explored locally (instant profiles, exact box/violin). Larger tables stay
   * at the source. Default 50,000.
   */
  materialiseLimit?: number
  /**
   * Let people open files. Files go to the first source that accepts uploads,
   * else into an in-browser DuckDB. Default true.
   */
  allowUpload?: boolean
  /** Where the in-browser DuckDB loads from (self-hosted for offline use). */
  wasm?: DuckDbWasmOptions
  /** Controlled theme; omit to let the studio own it (with a toggle). */
  theme?: ThemeMode
  /** Uncontrolled starting theme when nothing is stored. Default `"system"` — follows the OS / notebook. */
  defaultTheme?: ThemeMode
  onThemeChange?(theme: ThemeMode): void
  /** Prefix for everything the studio persists (layout, views, charts). */
  persistKey?: string
  /** Shown at the left of the top bar. */
  title?: ReactNode
  className?: string
  onTableChange?(table: TableRef): void
}

type Catalogs = Record<string, readonly TableInfo[]>
type Load = { key: string } & ({ status: 'idle' } | { status: 'loading'; loaded: number } | { status: 'ready'; rows: readonly Row[] | null } | { status: 'error'; message: string })

const DEFAULT_LIMIT = 50_000

function asList(sources: SheetbaseStudioProps['sources']): readonly StudioDataSource[] {
  if (!sources) return []
  return Array.isArray(sources) ? sources : [sources as StudioDataSource]
}

/**
 * Sheetbase Studio — explore and chart any table: a field browser with
 * profiles, the explorer, the filter builder, a read-only grid and SQL, all
 * driven by one shared view. Plug in any `StudioDataSource`.
 */
export function SheetbaseStudio(props: SheetbaseStudioProps) {
  const persistKey = props.persistKey ?? 'sheetbase-studio'
  const limit = props.materialiseLimit ?? DEFAULT_LIMIT
  const allowUpload = props.allowUpload !== false
  const { activeTheme, resolvedTheme, toggleTheme } = usePersistedTheme({ theme: props.theme, defaultTheme: props.defaultTheme ?? 'system', onThemeChange: props.onThemeChange })
  const given = useMemo(() => asList(props.sources), [props.sources])
  const uploadTarget = useMemo(() => given.find((source) => typeof source.upload === 'function'), [given])
  const [localSource, setLocalSource] = useState<MemorySource | null>(null)
  const sources = useMemo(() => (localSource ? [...given, localSource] : given), [given, localSource])
  const [catalogs, setCatalogs] = useState<Catalogs>({})
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({})
  const activeAdapter = useMemo(() => createLocalStorageAdapter<TableRef | null>(), [])
  const [active, setActive] = useState<TableRef | null>(() => {
    if (typeof props.initialTable === 'string') return { sourceId: given[0]?.id ?? '', tableId: props.initialTable }
    return props.initialTable ?? loadInitialState(`${persistKey}:active`, activeAdapter, null)
  })
  useIdleSave(`${persistKey}:active`, active, activeAdapter)
  const [sqlDrafts, setSqlDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const onTableChange = useRef(props.onTableChange)
  onTableChange.current = props.onTableChange

  const refreshCatalog = useCallback(async (source: StudioDataSource) => {
    try {
      const tables = await source.catalog()
      setCatalogs((current) => ({ ...current, [source.id]: tables }))
      setCatalogErrors((current) => {
        const { [source.id]: _dropped, ...rest } = current
        return rest
      })
      return tables
    } catch (error) {
      setCatalogErrors((current) => ({ ...current, [source.id]: error instanceof Error ? error.message : String(error) }))
      return []
    }
  }, [])

  useEffect(() => {
    for (const source of given) void refreshCatalog(source)
  }, [given, refreshCatalog])

  // Pick a table once catalogs arrive: keep a valid choice, else the first table.
  const resolved = useMemo(() => {
    const source = active ? sources.find((item) => item.id === active.sourceId) : undefined
    const table = source ? catalogs[source.id]?.find((item) => item.id === active?.tableId) : undefined
    return source && table ? { source, table } : null
  }, [active, sources, catalogs])
  useEffect(() => {
    if (resolved) return
    const waiting = given.some((source) => !catalogs[source.id] && !catalogErrors[source.id])
    if (active && waiting) return
    for (const source of sources) {
      const first = catalogs[source.id]?.[0]
      if (first) { setActive({ sourceId: source.id, tableId: first.id }); return }
    }
  }, [resolved, sources, given, catalogs, catalogErrors, active])
  useEffect(() => {
    if (resolved) onTableChange.current?.({ sourceId: resolved.source.id, tableId: resolved.table.id })
  }, [resolved])

  // Small tables come into the browser once; big ones stay at the source.
  const loadKey = resolved ? `${resolved.source.id}\u0000${resolved.table.id}\u0000${resolved.table.rowCount}` : ''
  const [loadState, setLoad] = useState<Load>({ key: '', status: 'idle' })
  // A load for another table is no load at all: never hand its rows to this one.
  const load: Load = loadState.key === loadKey ? loadState : { key: loadKey, status: 'loading', loaded: 0 }
  const [loadRetry, setLoadRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRetry is a manual re-fetch trigger
  useEffect(() => {
    const key = loadKey
    if (!resolved) { setLoad({ key, status: 'idle' }); return }
    const { source, table } = resolved
    const local = table.rowCount !== null && table.rowCount <= limit
    if (!local) { setLoad({ key, status: 'ready', rows: null }); return }
    const controller = new AbortController()
    setLoad({ key, status: 'loading', loaded: 0 })
    loadAllRows(source, table, controller.signal, (loaded) => {
      if (!controller.signal.aborted) setLoad({ key, status: 'loading', loaded })
    }).then(
      (rows) => { if (!controller.signal.aborted) setLoad({ key, status: 'ready', rows }) },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setLoad({ key, status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => controller.abort()
  }, [loadKey, limit, loadRetry])

  const openFiles = useCallback(async (files: FileList | readonly File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    let target: StudioDataSource | undefined = uploadTarget
    if (!target) {
      const created = localSource ?? new MemorySource({ id: 'local-files', label: 'Files on this computer', wasm: props.wasm })
      if (!localSource) setLocalSource(created)
      target = created
    }
    let opened: TableInfo | undefined
    for (const file of list) {
      setNotice({ kind: 'info', text: `Opening ${file.name}…` })
      try {
        const tables = await target.upload?.(file)
        opened ??= tables?.[0]
      } catch (error) {
        setNotice({ kind: 'error', text: `${file.name}: ${error instanceof Error ? error.message : String(error)}` })
        return
      }
    }
    await refreshCatalog(target)
    if (opened) setActive({ sourceId: target.id, tableId: opened.id })
    setNotice(null)
  }, [uploadTarget, localSource, props.wasm, refreshCatalog])

  const runSql = useCallback(async (sql: string) => {
    if (!resolved?.source.sql) throw new Error('This source does not accept SQL.')
    const info = await resolved.source.sql(sql)
    await refreshCatalog(resolved.source)
    setActive({ sourceId: resolved.source.id, tableId: info.id })
  }, [resolved, refreshCatalog])

  const onDrop = (event: DragEvent) => {
    if (!allowUpload) return
    event.preventDefault()
    setDragging(false)
    void openFiles(event.dataTransfer.files)
  }

  const picker = (
    <label className="sbs-picker">
      <span className="sbs-visually-hidden">Table</span>
      <select
        className="sb-input"
        value={resolved ? `${resolved.source.id}\u0000${resolved.table.id}` : ''}
        onChange={(event) => {
          const [sourceId = '', tableId = ''] = event.target.value.split('\u0000')
          setActive({ sourceId, tableId })
        }}
        aria-label="Table"
      >
        {!resolved && <option value="">{sources.length ? 'Choose a table' : 'No data yet'}</option>}
        {sources.map((source) => (
          <optgroup key={source.id} label={`${source.label}${catalogErrors[source.id] ? ' — unavailable' : ''}`}>
            {(catalogs[source.id] ?? []).map((table) => (
              <option key={table.id} value={`${source.id}\u0000${table.id}`}>
                {table.kind === 'query' ? '⌕ ' : ''}{table.label}{table.rowCount !== null ? ` · ${table.rowCount.toLocaleString()}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
  const openFileButton = allowUpload && (
    <button type="button" className="sb-btn" onClick={() => fileInput.current?.click()} title="CSV, TSV, Parquet, JSON or Excel">Open file…</button>
  )
  const fileInputElement = allowUpload && (
    <input ref={fileInput} type="file" accept={ACCEPTED_FILE_TYPES} multiple hidden onChange={(event) => { void openFiles(event.target.files); event.target.value = '' }} />
  )
  const brand = <span className="sbs-brand">{props.title ?? 'Studio'}</span>
  const sourceBadge = resolved && <span className="sbs-badge" title={`${resolved.source.label} (${resolved.source.kind})`}>{resolved.source.kind}</span>
  const noticeEl = notice && (
    <span className={`sbs-notice${notice.kind === 'error' ? ' is-error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.text}
      {notice.kind === 'error' && <button type="button" className="sb-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>}
    </span>
  )

  const frame = (chrome: { status?: ReactNode; actions?: ReactNode; body: ReactNode }) => (
    <SheetbaseShell
      theme={activeTheme}
      className={`sbs-studio${props.className ? ` ${props.className}` : ''}`}
      toolbar={<>{brand}{picker}{sourceBadge}<span className="sbs-wide-only">{openFileButton}</span>{fileInputElement}{noticeEl}</>}
      actions={
        <>
          <span className="sbs-wide-only">{chrome.status}{chrome.actions}</span>
          {/* Narrow hosts: the same actions behind one button, so the bar stays one row. */}
          <MoreMenu className="sbs-narrow-only">
            {chrome.status && <div className="sbs-more-status">{chrome.status}</div>}
            {openFileButton}
            {chrome.actions}
            <button type="button" className="sb-btn" onClick={toggleTheme}>{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          </MoreMenu>
        </>
      }
      onToggleTheme={toggleTheme}
      bodyClassName="sbs-body"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a file drop target; the keyboard path is the "Open file…" button */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same drop target as above */}
      <div
        className={`sbs-drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={allowUpload ? (event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } } : undefined}
        onDragLeave={allowUpload ? (event) => { if (event.currentTarget === event.target) setDragging(false) } : undefined}
        onDrop={onDrop}
      >
        {chrome.body}
        {dragging && <div className="sbs-drop-overlay" aria-hidden="true"><span>Drop to open</span></div>}
      </div>
    </SheetbaseShell>
  )

  if (!resolved || load.status !== 'ready') {
    const errors = Object.entries(catalogErrors)
    return frame({
      body: (
        <div className="sbs-empty">
          {load.status === 'loading' ? (
            <p><span className="sb-spinner" aria-hidden="true" /> Loading {resolved?.table.label}… {load.loaded ? `${load.loaded.toLocaleString()} rows` : ''}</p>
          ) : load.status === 'error' ? (
            <p className="sbs-note sbs-note--error">Couldn’t load {resolved?.table.label}: {load.message} <button type="button" className="sb-btn" onClick={() => setLoadRetry((n) => n + 1)}>Retry</button></p>
          ) : given.some((source) => !catalogs[source.id] && !catalogErrors[source.id]) ? (
            <p><span className="sb-spinner" aria-hidden="true" /> Connecting…</p>
          ) : (
            <>
              <h2>Nothing to explore yet</h2>
              <p>{allowUpload ? 'Drop a CSV, TSV, Parquet, JSON or Excel file here, or open one.' : 'Connect a data source to start exploring.'}</p>
              {allowUpload && <button type="button" className="sb-btn primary" onClick={() => fileInput.current?.click()}>Open a file…</button>}
            </>
          )}
          {errors.map(([id, message]) => <p key={id} className="sbs-note sbs-note--error">{sources.find((source) => source.id === id)?.label ?? id}: {message}</p>)}
        </div>
      ),
    })
  }

  return (
    <Workspace
      key={`${resolved.source.id}\u0000${resolved.table.id}`}
      source={resolved.source}
      table={resolved.table}
      tables={catalogs[resolved.source.id] ?? []}
      rows={load.rows}
      persistKey={persistKey}
      theme={activeTheme}
      resolvedTheme={resolvedTheme}
      onThemeChange={toggleTheme}
      onRunSql={runSql}
      sqlDraft={sqlDrafts[resolved.source.id]}
      onSqlDraft={(sql) => setSqlDrafts((current) => ({ ...current, [resolved.source.id]: sql }))}
      onOpenTable={(tableId) => setActive({ sourceId: resolved.source.id, tableId })}
      frame={frame}
    />
  )
}
