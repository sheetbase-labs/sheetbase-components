import { useState, type ComponentProps, type ReactNode, type Ref, type RefObject, type SetStateAction } from 'react'
import { Chart } from '@tanstack/charts/react/tooltip'
import { ThemeToggleButton } from '@sheetbase-labs/sheetbase-shared'
import { DataMenus, SeriesLegend, ViewMenus, type Menu } from './explorer-popovers'
import { ROW_ID } from './lib/explore'
import type { ChartKind, ChartSpec, DataAdapter, Dataset, SavedExploration } from './lib/types'

export function CommandBar({ menu, spec, dataset, sources, saved, libraryName, exportStatus, importStatus, dark, showThemeToggle, setSpec, onAnalysisSpec, viewFilterLocked, onReset, onField, onChoosePlot, onExportSvg, onExportPng, onCopySpec, onCopyLink, onSaveExploration, onLoadExploration, onDeleteExploration, onLibraryName, onLoadSource, onOpenFile, onMenuToggle, onMenuClose, onToggleDark }: {
  menu: Menu
  spec: ChartSpec
  dataset: Dataset
  sources: DataAdapter[]
  saved: SavedExploration[]
  libraryName: string
  exportStatus: string | null
  importStatus: string | null
  dark: boolean
  showThemeToggle: boolean
  setSpec(action: SetStateAction<ChartSpec>): void
  /** Group/Filter edits (view-aware when the host controls an analysis view). */
  onAnalysisSpec(action: SetStateAction<ChartSpec>): void
  /** The host's view filter tree can't be edited as flat rules — show a note instead. */
  viewFilterLocked?: boolean
  /** Restore the dataset's default chart. */
  onReset(): void
  onField(role: 'x' | 'y' | 'color' | 'facet', value?: string): void
  onChoosePlot(kind: ChartKind): void
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
  onMenuToggle(id: Exclude<Menu, null>): void
  onMenuClose(): void
  onToggleDark(): void
}) {
  return (<>
    <div className="explorer-commandbar explorer-commandbar-v4">
      <DataMenus menu={menu} onMenuToggle={onMenuToggle} spec={spec} dataset={dataset} setSpec={setSpec} onAnalysisSpec={onAnalysisSpec} viewFilterLocked={viewFilterLocked} onField={onField} onChoosePlot={onChoosePlot} />
      <span className="command-spacer"/>{showThemeToggle && <ThemeToggleButton theme={dark ? 'dark' : 'light'} onToggle={onToggleDark} />}{menu && <button type="button" aria-label="Close menu" className="menu-backdrop" onClick={onMenuClose} />}
    </div>
    <div className="sb-subbar explorer-subbar">
      <ViewMenus menu={menu} onMenuToggle={onMenuToggle} spec={spec} dataset={dataset} setSpec={setSpec} sources={sources} saved={saved} libraryName={libraryName} exportStatus={exportStatus} importStatus={importStatus} onExportSvg={onExportSvg} onExportPng={onExportPng} onCopySpec={onCopySpec} onCopyLink={onCopyLink} onSaveExploration={onSaveExploration} onLoadExploration={onLoadExploration} onDeleteExploration={onDeleteExploration} onLibraryName={onLibraryName} onLoadSource={onLoadSource} onOpenFile={onOpenFile} />
      <button type="button" className="explorer-reset" onClick={onReset}>Reset</button>
    </div>
  </>)
}

export function ChartStage({ stageRef, seriesValues, palette, hiddenSeries, onToggleSeries, definition, chartHeight, chartLabel, onSelectRowId }: {
  stageRef: Ref<HTMLDivElement>
  seriesValues: string[]
  palette: string[]
  hiddenSeries: Set<string>
  onToggleSeries(value: string, isolate?: boolean): void
  definition: ComponentProps<typeof Chart>['definition'] | null
  chartHeight: number
  chartLabel: string
  onSelectRowId(index: number, datum: Record<string, unknown>): void
}) {
  return (
    <div className="chart-stage chart-stage-v3" ref={stageRef}>{seriesValues.length > 1 && <SeriesLegend values={seriesValues} palette={palette} hidden={hiddenSeries} onToggle={onToggleSeries} />}{definition ? <div className="chart-wrap"><Chart definition={definition} height={chartHeight} ariaLabel={chartLabel} renderTooltipBody={({ defaultBody }) => <div className="sheetbase-tooltip-body">{defaultBody}</div>} onSelect={(point) => { const datum = point?.datum as Record<string, unknown> | undefined; if (datum && typeof datum[ROW_ID] === 'number') onSelectRowId(Number(datum[ROW_ID]), datum) }}/></div> : <div className="empty-state"><strong>Choose fields to begin</strong><span>Use Fields in the toolbar to map X and Y.</span></div>}</div>
  )
}

/**
 * Guarded render update (React-sanctioned prop-sync alternative): tracks the
 * last dataset identity so transient selection and zoom reset exactly once
 * per swap. The hook owns only its marker; the caller resets its own state,
 * which keeps render pure of prop-callback invocations.
 */
export function useDatasetSwap(dataset: Dataset | null): boolean {
  const [lastDataset, setLastDataset] = useState<Dataset | null>(null)
  if (dataset !== lastDataset) {
    setLastDataset(dataset)
    return true
  }
  return false
}

export function ExplorerFrame({ framed = true, rootRef, panel = true, panelCollapsed, panelHeight, children }: {
  framed?: boolean
  rootRef: RefObject<HTMLDivElement | null>
  /** Render the bottom data/SQL panel. Default true. */
  panel?: boolean
  panelCollapsed: boolean
  panelHeight: number
  children: ReactNode
}) {
  const rows = !panel ? 'minmax(0, 1fr)' : panelCollapsed ? 'minmax(0, 1fr) 34px' : `minmax(0, 1fr) ${panelHeight}px`
  return (
    <div ref={rootRef} className={framed ? 'sheetbase-explorer framed' : 'sheetbase-explorer'}>
      {framed
        ? <div className="app-shell explorer-app-v3"><div className="explorer-frame explorer-frame-v3 explorer-frame-v4" style={{ gridTemplateRows: rows }}>{children}</div></div>
        : children}
    </div>
  )
}


