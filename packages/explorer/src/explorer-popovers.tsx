import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from 'react'
import { Chart } from '@tanstack/charts/react/tooltip'
import { HugeiconsIcon } from '@hugeicons/react'
import { FileUploadIcon, PlayIcon, ReloadIcon } from '@hugeicons/core-free-icons'
import { DataTable } from './components/DataTable'
import { FieldSelect } from './components/FieldSelect'
import { filterOperators } from './lib/filter-operators'
import { datasetFromFile } from './lib/adapters/file'
import { sampleAdapter } from './lib/adapters/sample'
import { buildChart } from './lib/chart'
import { filteredRows, ROW_ID } from './lib/explore'
import { CURRENT_EXPLORATION_VERSION, decodeShareHash, defaultExplorerAdapter, encodeShareHash, EXPLORER_STORAGE_KEY, loadInitialExplorerState, useIdleExplorerSave, type PersistedExplorerState } from './lib/persistence'
import { downloadText, exportChartPng, serializeChartSvg, specJson } from './lib/export'
import { runSqlAsync } from './lib/sql'
import type { ChartKind, ChartSpec, DataAdapter, Dataset, FilterOperator, FilterRule, PaletteKind, SavedExploration } from './lib/types'

export const PALETTES: Record<Exclude<PaletteKind, 'custom'>, string[]> = {
  sheetbase: ['#7652ef', '#07956a', '#c95814', '#286dcc', '#9541b7', '#6d7d4b'],
  muted: ['#6f67a8', '#5d8f85', '#b07b58', '#7187a8', '#9a7088', '#85866d'],
  warm: ['#a44734', '#d16b45', '#e19852', '#c56d78', '#8c5c76', '#6f5b50'],
  cool: ['#4f5cc4', '#327c9b', '#2e947d', '#6f67b1', '#5479a8', '#5d8f85'],
  mono: ['#28282a', '#53535a', '#777780', '#9a9aa2', '#bdbdc3', '#dedee2'],
}

export const initialSpec: ChartSpec = {
  kind: 'scatter', x: 'day', y: 'response', color: 'treatment',
  errorMode: 'explicit', errorLow: 'low', errorHigh: 'high', filters: [], filterLogic: 'and', aggregate: 'none',
  showPoints: true, showRawPoints: false, showRibbon: false, showRegression: false, showGrid: true,
  pointSize: 5, pointOpacity: 0.9, lineWidth: 2, lineOpacity: 0.9,
  fillOpacity: 0.82, barGap: 2, barRadius: 3, barLayout: 'grouped', histogramBins: 12,
  primaryColor: '#7652ef', markColor: '#7652ef', paletteKind: 'sheetbase', palette: PALETTES.sheetbase,
  hiddenSeries: [],
}

export const initialSql = 'SELECT * FROM ?'
export type BottomTab = 'data' | 'sql'
export type Menu = 'plot' | 'fields' | 'group' | 'filter' | 'error' | 'axes' | 'style' | 'library' | 'export' | 'import' | null
const plotKinds: Array<{ kind: ChartKind; label: string }> = [
  { kind: 'scatter', label: 'Scatter' }, { kind: 'line', label: 'Line' }, { kind: 'bar', label: 'Bar' },
  { kind: 'horizontal-bar', label: 'Horizontal bar' }, { kind: 'area', label: 'Area' },
  { kind: 'histogram', label: 'Histogram' }, { kind: 'box', label: 'Box plot' },
]

function RangeControl({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange(value: number): void }) {
  const id = useId()
  return <div className="range-control"><label htmlFor={id}>{label}</label><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/><output htmlFor={id}>{value}</output></div>
}

/** Single-pass distinct-value collector with an early cap (avoids map/filter/re-slice passes). */
function distinctFieldValues(rows: Dataset['rows'], field: string, limit: number): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const row of rows) {
    const value = String(row[field] ?? '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
    if (values.length >= limit) break
  }
  return values
}

function PlotPopover({ activeKind, onChoose }: { activeKind: ChartKind; onChoose(kind: ChartKind): void }) {
  return (
    <>{plotKinds.map(({ kind, label }) => <button className={activeKind === kind ? 'selected' : ''} key={kind} onClick={() => onChoose(kind)}>{label}</button>)}</>
  )
}

function FieldsPopover({ spec, columns, setSpec, onField, onAutoKind }: { spec: ChartSpec; columns: Dataset['columns']; setSpec(action: SetStateAction<ChartSpec>): void; onField(role: 'x' | 'y' | 'color' | 'facet', value?: string): void; onAutoKind(): void }) {
  const facetColumns = columns.filter((column) => column.kind !== 'number' && column.uniqueCount <= 60)
  const currentFacet = spec.facet ? columns.find((column) => column.key === spec.facet) : undefined
  const facetOptions = currentFacet && !facetColumns.some((column) => column.key === currentFacet.key) ? [currentFacet, ...facetColumns] : facetColumns
  return (
    <><div className="popover-title-row"><h4>Data fields</h4><button onClick={onAutoKind}>Auto</button></div><FieldSelect label="X" value={spec.x} columns={columns} allowNone={false} onChange={(value) => onField('x', value)}/>{spec.kind !== 'histogram' && <FieldSelect label="Y" value={spec.y} columns={columns} allowNone={false} onChange={(value) => onField('y', value)}/>}<FieldSelect label="Colour by" value={spec.color} columns={columns} onChange={(value) => onField('color', value)}/>{spec.kind === 'scatter' && spec.color && <label className="compact-control"><span>Colour scale</span><select value={spec.colorScale ?? 'auto'} onChange={(event) => setSpec((current) => ({ ...current, colorScale: event.target.value as ChartSpec['colorScale'] }))}><option value="auto">Auto</option><option value="continuous">Value (gradient)</option><option value="categorical">Categories</option></select></label>}<FieldSelect label="Facet" value={spec.facet} columns={facetOptions} onChange={(value) => onField('facet', value)}/></>
  )
}

function GroupPopover({ spec, columns, setSpec }: { spec: ChartSpec; columns: Dataset['columns']; setSpec(action: SetStateAction<ChartSpec>): void }) {
  return (
    <><h4>Group & summarise</h4><FieldSelect label="Group" value={spec.group} columns={columns} onChange={(value) => setSpec((current) => ({ ...current, group: value, hiddenSeries: [] }))}/><label className="compact-control"><span>Summary</span><select value={spec.aggregate} onChange={(event) => setSpec((current) => ({ ...current, aggregate: event.target.value as ChartSpec['aggregate'] }))}><option value="none">Raw rows</option><option value="mean">Mean</option><option value="median">Median</option><option value="sum">Sum</option><option value="count">Count</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label><label className="toggle-row"><span>Show raw observations</span><input type="checkbox" checked={spec.showRawPoints ?? false} onChange={(event) => setSpec((current) => ({ ...current, showRawPoints: event.target.checked }))}/></label></>
  )
}

function FilterPopover({ spec, dataset, setSpec }: { spec: ChartSpec; dataset: Dataset; setSpec(action: SetStateAction<ChartSpec>): void }) {
  const filters = spec.filters ?? []
  function addFilter() {
    const field = dataset?.columns[0]?.key
    if (!field) return
    setSpec((current) => ({ ...current, filters: [...(current.filters ?? []), { id: crypto.randomUUID(), field, operator: 'eq', value: '' }] }))
  }
  function patchFilter(id: string, patch: Partial<FilterRule>) { setSpec((current) => ({ ...current, filters: (current.filters ?? []).map((rule) => rule.id === id ? { ...rule, ...patch } : rule) })) }
  function removeFilter(id: string) { setSpec((current) => ({ ...current, filters: (current.filters ?? []).filter((rule) => rule.id !== id) })) }
  return (
    <><div className="popover-title-row"><h4>Filters</h4><button onClick={addFilter}>+ Add</button></div><label className="compact-control"><span>Match</span><select value={spec.filterLogic ?? 'and'} onChange={(event) => setSpec((current) => ({ ...current, filterLogic: event.target.value as ChartSpec['filterLogic'] }))}><option value="and">All filters</option><option value="or">Any filter</option></select></label>{filters.map((rule, ruleIndex) => { const meta = dataset.columns.find((column) => column.key === rule.field) ?? dataset.columns[0]!; const values = meta.kind === 'string' || meta.kind === 'boolean' ? distinctFieldValues(dataset.rows, rule.field, 100) : []; return <div className="filter-rule" key={rule.id}><select aria-label="Filter field" value={rule.field} onChange={(event) => patchFilter(rule.id, { field: event.target.value, operator: 'eq', value: '', value2: undefined, values: undefined })}>{dataset.columns.map((column) => <option key={column.key} value={column.key}>{column.key}</option>)}</select><select aria-label="Filter operator" value={rule.operator} onChange={(event) => patchFilter(rule.id, { operator: event.target.value as FilterOperator })}>{filterOperators(meta.kind).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{rule.operator === 'in' ? <select aria-label="Filter values" multiple value={rule.values ?? []} onChange={(event) => patchFilter(rule.id, { values: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{values.map((value) => <option value={value} key={value}>{value}</option>)}</select> : <input aria-label="Filter value" type={meta.kind === 'date' ? 'date' : meta.kind === 'number' ? 'number' : 'text'} value={rule.value ?? ''} onChange={(event) => patchFilter(rule.id, { value: event.target.value })}/>} {rule.operator === 'between' && <input aria-label="Filter upper value" type={meta.kind === 'date' ? 'date' : 'number'} value={rule.value2 ?? ''} onChange={(event) => patchFilter(rule.id, { value2: event.target.value })}/>}<button aria-label={`Remove filter ${ruleIndex + 1}`} className="filter-remove" onClick={() => removeFilter(rule.id)}>×</button></div>})}{filters.length > 0 && <button className="popover-clear" onClick={() => setSpec((current) => ({ ...current, filters: [] }))}>Clear all</button>}</>
  )
}

function ErrorPopover({ spec, dataset, setSpec }: { spec: ChartSpec; dataset: Dataset; setSpec(action: SetStateAction<ChartSpec>): void }) {
  return (
    <><h4>Uncertainty</h4><label className="compact-control"><span>Mode</span><select value={spec.errorMode ?? 'none'} onChange={(event) => setSpec((current) => ({ ...current, errorMode: event.target.value as ChartSpec['errorMode'], aggregate: ['sd','sem','ci95'].includes(event.target.value) && current.aggregate === 'none' ? 'mean' : current.aggregate }))}><option value="none">None</option><option value="explicit">Lower/upper columns</option><option value="sd">Standard deviation</option><option value="sem">SEM</option><option value="ci95">95% CI</option></select></label>{spec.errorMode === 'explicit' && <><FieldSelect label="Lower" value={spec.errorLow} columns={dataset.columns.filter((column) => column.kind === 'number')} onChange={(value) => setSpec((current) => ({ ...current, errorLow: value }))}/><FieldSelect label="Upper" value={spec.errorHigh} columns={dataset.columns.filter((column) => column.kind === 'number')} onChange={(value) => setSpec((current) => ({ ...current, errorHigh: value }))}/></>}<label className="toggle-row"><span>Confidence ribbon</span><input type="checkbox" checked={spec.showRibbon ?? false} disabled={!['line','area'].includes(spec.kind)} onChange={(event) => setSpec((current) => ({ ...current, showRibbon: event.target.checked }))}/></label></>
  )
}

function AxesPopover({ spec, setSpec }: { spec: ChartSpec; setSpec(action: SetStateAction<ChartSpec>): void }) {
  return (
    <><h4>Axes</h4><label className="compact-control"><span>X label</span><input value={spec.xLabel ?? ''} placeholder={spec.x ?? 'X'} onChange={(event) => setSpec((current) => ({ ...current, xLabel: event.target.value || undefined }))}/></label><label className="compact-control"><span>Y label</span><input value={spec.yLabel ?? ''} placeholder={spec.kind === 'histogram' ? 'Count' : (spec.y ?? 'Y')} onChange={(event) => setSpec((current) => ({ ...current, yLabel: event.target.value || undefined }))}/></label><label className="compact-control"><span>X scale</span><select value={spec.xScale ?? 'auto'} onChange={(event) => setSpec((current) => ({ ...current, xScale: event.target.value as ChartSpec['xScale'] }))}><option value="auto">Auto</option><option value="linear">Linear</option><option value="log" disabled={['bar', 'horizontal-bar', 'histogram', 'area'].includes(spec.kind)}>Log</option></select></label><label className="compact-control"><span>Y scale</span><select value={spec.yScale ?? 'auto'} onChange={(event) => setSpec((current) => ({ ...current, yScale: event.target.value as ChartSpec['yScale'] }))}><option value="auto">Auto</option><option value="linear">Linear</option><option value="log" disabled={['bar', 'horizontal-bar', 'histogram', 'area'].includes(spec.kind)}>Log</option></select></label><div className="axis-range-grid"><label><span>X min</span><input type="number" value={spec.xMin ?? ''} onChange={(event) => setSpec((current) => ({ ...current, xMin: event.target.value === '' ? undefined : Number(event.target.value), zoomX: undefined }))}/></label><label><span>X max</span><input type="number" value={spec.xMax ?? ''} onChange={(event) => setSpec((current) => ({ ...current, xMax: event.target.value === '' ? undefined : Number(event.target.value), zoomX: undefined }))}/></label><label><span>Y min</span><input type="number" value={spec.yMin ?? ''} onChange={(event) => setSpec((current) => ({ ...current, yMin: event.target.value === '' ? undefined : Number(event.target.value) }))}/></label><label><span>Y max</span><input type="number" value={spec.yMax ?? ''} onChange={(event) => setSpec((current) => ({ ...current, yMax: event.target.value === '' ? undefined : Number(event.target.value) }))}/></label></div><label className="toggle-row"><span>Grid lines</span><input type="checkbox" checked={spec.showGrid} onChange={(event) => setSpec((current) => ({ ...current, showGrid: event.target.checked }))}/></label><div className="zoom-controls"><label className="toggle-row"><span>Zoom / pan</span><input type="checkbox" checked={spec.zoomEnabled ?? false} onChange={(event) => setSpec((current) => ({ ...current, zoomEnabled: event.target.checked }))}/></label><button disabled={!spec.zoomX} onClick={() => setSpec((current) => ({ ...current, zoomX: undefined }))}>Reset zoom</button><span>{spec.zoomEnabled ? 'Drag to pan · wheel to zoom · hover values off' : 'Hover chart for values'}</span></div></>
  )
}

function StylePopover({ spec, setSpec }: { spec: ChartSpec; setSpec(action: SetStateAction<ChartSpec>): void }) {
  function setPalette(kind: PaletteKind) {
    setSpec((current) => ({ ...current, paletteKind: kind, palette: kind === 'custom' ? current.palette : PALETTES[kind], primaryColor: kind === 'custom' ? current.primaryColor : PALETTES[kind][0]!, markColor: kind === 'custom' ? current.markColor : PALETTES[kind][0]! }))
  }
  function setPaletteColor(index: number, color: string) {
    setSpec((current) => { const palette = [...current.palette]; palette[index] = color; return { ...current, paletteKind: 'custom', palette, primaryColor: index === 0 ? color : current.primaryColor, markColor: index === 0 ? color : current.markColor } })
  }
  return (
    <><h4>Style</h4><label className="compact-control"><span>Palette</span><select value={spec.paletteKind ?? 'sheetbase'} onChange={(event) => setPalette(event.target.value as PaletteKind)}><option value="sheetbase">Sheetbase</option><option value="muted">Muted</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="mono">Monochrome</option><option value="custom">Custom</option></select></label><label className="colour-control"><span>Mark colour</span><input type="color" value={spec.markColor ?? spec.primaryColor ?? spec.palette[0]} onChange={(event) => setSpec((current) => ({ ...current, markColor: event.target.value, primaryColor: event.target.value, paletteKind: 'custom' }))}/></label><div className="palette-editor"><span>Series colours</span><div className="palette-swatches">{spec.palette.slice(0, 6).map((color, index) => (
      // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- fixed six-slot editor: slots never reorder or filter, so the slot index is a stable key.
      <label key={`${index}-${color}`}>
        <input type="color" aria-label={`Series colour ${index + 1}`} value={color} onChange={(event) => setPaletteColor(index, event.target.value)} />
        <i style={{ background: color }} />
      </label>
    ))}</div></div>{spec.kind === 'scatter' && <><RangeControl label="Point size" min={2} max={12} step={1} value={spec.pointSize} onChange={(value) => setSpec((current) => ({ ...current, pointSize: value }))}/><RangeControl label="Opacity" min={0.1} max={1} step={0.1} value={spec.pointOpacity} onChange={(value) => setSpec((current) => ({ ...current, pointOpacity: value }))}/><label className="toggle-row"><span>Regression + 95% CI</span><input type="checkbox" checked={spec.showRegression ?? false} onChange={(event) => setSpec((current) => ({ ...current, showRegression: event.target.checked }))}/></label></>}{spec.kind === 'line' && <><RangeControl label="Line width" min={1} max={6} step={0.5} value={spec.lineWidth} onChange={(value) => setSpec((current) => ({ ...current, lineWidth: value }))}/><label className="toggle-row"><span>Show points</span><input type="checkbox" checked={spec.showPoints} onChange={(event) => setSpec((current) => ({ ...current, showPoints: event.target.checked }))}/></label></>}{['bar', 'horizontal-bar'].includes(spec.kind) && <><label className="compact-control"><span>Layout</span><select value={spec.barLayout} onChange={(event) => setSpec((current) => ({ ...current, barLayout: event.target.value as ChartSpec['barLayout'] }))}><option value="grouped">Side by side</option><option value="stacked">Stacked</option><option value="normalized">100% stacked</option></select></label><RangeControl label="Bar gap" min={0} max={8} step={1} value={spec.barGap} onChange={(value) => setSpec((current) => ({ ...current, barGap: value }))}/><RangeControl label="Corners" min={0} max={10} step={1} value={spec.barRadius} onChange={(value) => setSpec((current) => ({ ...current, barRadius: value }))}/></>}{spec.kind === 'histogram' && <RangeControl label="Bins" min={4} max={40} step={1} value={spec.histogramBins} onChange={(value) => setSpec((current) => ({ ...current, histogramBins: value }))}/>}</>
  )
}

function ExportPopover({ status, onSvg, onPng, onCopySpec, onCopyLink }: { status: string | null; onSvg(): void; onPng(): void; onCopySpec(): void; onCopyLink(): void }) {
  return (
    <><h4>Export</h4><div className="export-actions"><button onClick={onSvg}>Download SVG</button><button onClick={onPng}>Download PNG</button><button onClick={onCopySpec}>Copy spec JSON</button><button onClick={onCopyLink}>Copy share link</button></div>{status && <p className="muted">{status}</p>}</>
  )
}

function LibraryPopover({ saved, name, onName, onSave, onLoad, onDelete }: { saved: SavedExploration[]; name: string; onName(name: string): void; onSave(): void; onLoad(id: string): void; onDelete(id: string): void }) {
  return (
    <><div className="popover-title-row"><h4>Explorations</h4><span className="muted">Auto-saves this session</span></div><div className="library-save-row"><input aria-label="Name this view" value={name} placeholder="Name this view…" onChange={(event) => onName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSave() }}/><button disabled={!name.trim()} onClick={onSave}>Save</button></div>{saved.length === 0 ? <p className="muted">No named views yet.</p> : <ul className="library-list">{saved.map((entry) => <li key={entry.id}><button className="library-load" onClick={() => onLoad(entry.id)}><span>{entry.name}</span><small>{new Date(entry.updatedAt).toLocaleString()}</small></button><button className="library-delete" aria-label={`Delete ${entry.name}`} onClick={() => onDelete(entry.id)}>✕</button></li>)}</ul>}</>
  )
}

function ImportPopover({ sources, status, onLoadSource, onOpenFile }: { sources: DataAdapter[]; status: string | null; onLoadSource(id: string): void; onOpenFile(file?: File): void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <><h4>Dataset</h4><div className="export-actions"><button onClick={() => fileRef.current?.click()}><HugeiconsIcon icon={FileUploadIcon} size={13}/>From file…</button></div><ul className="library-list">{sources.map((source) => <li key={source.id}><button className="library-load" onClick={() => onLoadSource(source.id)}><span>{source.label}</span><small>{source.id}</small></button></li>)}</ul><input ref={fileRef} type="file" hidden accept=".csv,.tsv,.json,text/csv,application/json" onChange={(event) => onOpenFile(event.target.files?.[0])}/>{status && <p className="muted">{status}</p>}</>
  )
}

export function SeriesLegend({ values, palette, hidden, onToggle }: {
  values: string[]
  palette: string[]
  hidden: Set<string>
  onToggle(value: string, isolate?: boolean): void
}) {
  return (
    <div className="series-legend">
      {values.map((value, index) => {
        const isHidden = hidden.has(value)
        return <button key={value} className={isHidden ? 'hidden' : ''} onClick={(event) => { event.stopPropagation(); onToggle(value, event.shiftKey) }} title="Click to hide/show. Shift-click to isolate."><i style={{ background: palette[index % palette.length] }} /><span>{value}</span></button>
      })}
    </div>
  )
}

export function BottomPanel({ tab, onTab, collapsed, onToggleCollapsed, visibleCount, totalCount, panelHeight, onResizeStart, onResizeStep, children }: {
  tab: BottomTab
  onTab(tab: BottomTab): void
  collapsed: boolean
  onToggleCollapsed(): void
  visibleCount: number
  totalCount: number
  panelHeight: number
  onResizeStart(event: ReactPointerEvent): void
  onResizeStep(delta: number): void
  children: ReactNode
}) {
  return (
    <section className={`bottom-panel bottom-panel-v3 ${collapsed ? 'collapsed' : ''}`}><div className="panel-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" aria-valuenow={panelHeight} aria-valuemin={120} aria-valuemax={560} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={(event) => { if (event.key === 'ArrowUp') { event.preventDefault(); onResizeStep(10) } else if (event.key === 'ArrowDown') { event.preventDefault(); onResizeStep(-10) } }} /><div className="bottom-tabs"><button className={tab === 'data' ? 'active' : ''} onClick={() => onTab('data')}>Data</button><button className={tab === 'sql' ? 'active' : ''} onClick={() => onTab('sql')}>SQL</button><span className="row-count">{visibleCount.toLocaleString()} / {totalCount.toLocaleString()} rows</span><button className="panel-collapse" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'} onClick={onToggleCollapsed}>{collapsed ? '▴' : '▾'}</button></div>{!collapsed && <div className="bottom-content">{children}</div>}</section>
  )
}

export function smartKindFor(dataset: Dataset | null, x?: string, y?: string): ChartKind | undefined {
  if (!dataset || !x) return undefined
  const xMeta = dataset.columns.find((column) => column.key === x)
  const yMeta = dataset.columns.find((column) => column.key === y)
  if (!y) return xMeta?.kind === 'number' ? 'histogram' : undefined
  if (xMeta?.kind === 'date' && yMeta?.kind === 'number') return 'line'
  if (xMeta?.kind === 'number' && yMeta?.kind === 'number') return 'scatter'
  if ((xMeta?.kind === 'string' || xMeta?.kind === 'boolean') && yMeta?.kind === 'number') return 'box'
  return undefined
}


function MenuButton({ id, label, detail, active, onToggle }: {
  id: Exclude<Menu, null>
  label: string
  detail?: string
  active: boolean
  onToggle(id: Exclude<Menu, null>): void
}) {
  return <button className={`explorer-tool ${active ? 'active' : ''}`} onClick={() => onToggle(id)}><span>{label}</span>{detail && <small>{detail}</small>}<b>⌄</b></button>
}

export function DataMenus({ menu, onMenuToggle, spec, dataset, setSpec, onAnalysisSpec, onField, onAutoKind, onChoosePlot }: {
  menu: Menu
  onMenuToggle(id: Exclude<Menu, null>): void
  spec: ChartSpec
  dataset: Dataset
  setSpec(action: SetStateAction<ChartSpec>): void
  onAnalysisSpec(action: SetStateAction<ChartSpec>): void
  onField(role: 'x' | 'y' | 'color' | 'facet', value?: string): void
  onAutoKind(): void
  onChoosePlot(kind: ChartKind): void
}) {
  return (
    <>
      <div className="tool-anchor"><MenuButton id="plot" label="Plot" detail={plotKinds.find((item) => item.kind === spec.kind)?.label} active={menu === 'plot'} onToggle={onMenuToggle} />{menu === 'plot' && <div className="tool-popover plot-popover"><PlotPopover activeKind={spec.kind} onChoose={onChoosePlot} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="fields" label="Fields" detail={[spec.x && `X ${spec.x}`, spec.y && `Y ${spec.y}`].filter(Boolean).join(' · ')} active={menu === 'fields'} onToggle={onMenuToggle} />{menu === 'fields' && <div className="tool-popover inspector-popover"><FieldsPopover spec={spec} columns={dataset.columns} setSpec={setSpec} onField={onField} onAutoKind={() => { const inferred = smartKindFor(dataset, spec.x, spec.y); if (inferred) setSpec((current) => ({ ...current, kind: inferred })) }} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="group" label="Group" detail={spec.group ?? (spec.aggregate === 'none' ? undefined : spec.aggregate)} active={menu === 'group'} onToggle={onMenuToggle} />{menu === 'group' && <div className="tool-popover inspector-popover"><GroupPopover spec={spec} columns={dataset.columns} setSpec={onAnalysisSpec} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="filter" label="Filter" detail={spec.filters?.length ? String(spec.filters.length) : undefined} active={menu === 'filter'} onToggle={onMenuToggle} />{menu === 'filter' && <div className="tool-popover inspector-popover filter-popover"><FilterPopover spec={spec} dataset={dataset} setSpec={onAnalysisSpec} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="error" label="Error" detail={(spec.errorMode ?? 'none') === 'none' ? undefined : String(spec.errorMode).toUpperCase()} active={menu === 'error'} onToggle={onMenuToggle} />{menu === 'error' && <div className="tool-popover inspector-popover"><ErrorPopover spec={spec} dataset={dataset} setSpec={setSpec} /></div>}</div>
    </>
  )
}

export function ViewMenus({ menu, onMenuToggle, spec, dataset, setSpec, sources, saved, libraryName, exportStatus, importStatus, onExportSvg, onExportPng, onCopySpec, onCopyLink, onSaveExploration, onLoadExploration, onDeleteExploration, onLibraryName, onLoadSource, onOpenFile }: {
  menu: Menu
  onMenuToggle(id: Exclude<Menu, null>): void
  spec: ChartSpec
  dataset: Dataset
  setSpec(action: SetStateAction<ChartSpec>): void
  sources: DataAdapter[]
  saved: SavedExploration[]
  libraryName: string
  exportStatus: string | null
  importStatus: string | null
  onExportSvg(): void
  onExportPng(): void
  onCopySpec(): void
  onCopyLink(): void
  onSaveExploration(): void
  onLoadExploration(id: string): void
  onDeleteExploration(id: string): void
  onLibraryName(name: string): void
  onLoadSource(id: string): void
  onOpenFile(file?: File): void
}) {
  return (
    <>
      <div className="tool-anchor"><MenuButton id="axes" label="Axes" active={menu === 'axes'} onToggle={onMenuToggle} />{menu === 'axes' && <div className="tool-popover inspector-popover"><AxesPopover spec={spec} setSpec={setSpec} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="style" label="Style" active={menu === 'style'} onToggle={onMenuToggle} />{menu === 'style' && <div className="tool-popover inspector-popover style-popover"><StylePopover spec={spec} setSpec={setSpec} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="export" label="Export" active={menu === 'export'} onToggle={onMenuToggle} />{menu === 'export' && <div className="tool-popover inspector-popover"><ExportPopover status={exportStatus} onSvg={onExportSvg} onPng={onExportPng} onCopySpec={onCopySpec} onCopyLink={onCopyLink} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="library" label="Library" detail={saved.length ? String(saved.length) : undefined} active={menu === 'library'} onToggle={onMenuToggle} />{menu === 'library' && <div className="tool-popover inspector-popover library-popover"><LibraryPopover saved={saved} name={libraryName} onName={onLibraryName} onSave={onSaveExploration} onLoad={onLoadExploration} onDelete={onDeleteExploration} /></div>}</div>
      <div className="tool-anchor"><MenuButton id="import" label="Import" active={menu === 'import'} onToggle={onMenuToggle} />{menu === 'import' && <div className="tool-popover inspector-popover"><ImportPopover sources={sources} status={importStatus} onLoadSource={onLoadSource} onOpenFile={onOpenFile} /></div>}</div>
    </>
  )
}

