import { useCallback, useMemo, useRef, useState, Profiler } from "react";
import { HttpPagedDataAdapter } from "../data/http-adapter";
import { PagedSpreadsheet } from "./PagedSpreadsheet";
import { TableControls } from "./TableControls";
import { ConditionalFormattingInspector, TableFormattingToolbar, TableSurface } from "./TableSurface";
import type { SpreadsheetHandle, SpreadsheetSelection } from "./Spreadsheet";
import type { ConditionalFormatRule } from "../grid/conditional-formatting";
import type { DatasetQuery } from "../data";
import { parseAddress } from "../engine/coordinates";
import type { CellRange } from "../engine/types";
import { createHttpPresentationAdapter, createLocalStoragePresentationAdapter, useResolvedTheme, useTablePresentationState, type ColumnPresentation, type TablePresentationState } from "./presentation-state";

const fields = [
  { id: "experiment_id", label: "experiment_id", column: 0, writable: false, dataType: "text" as const },
  { id: "sample_id", label: "sample_id", column: 1, required: true, dataType: "text" as const },
  { id: "assay", label: "assay", column: 2, required: true, dataType: "text" as const },
  { id: "result", label: "result", column: 3, dataType: "number" as const },
  { id: "unit", label: "unit", column: 4, options: ["ng/mL", "ng/dose", "Ct", "mg/mL"], dataType: "text" as const },
  { id: "run_date", label: "run_date", column: 5, dataType: "date" as const },
  { id: "status", label: "status", column: 6, options: ["Complete", "Review", "Flagged"], dataType: "text" as const },
  { id: "reviewer", label: "reviewer", column: 7, options: ["Alice Chen", "David Okafor", "Maya Singh"], dataType: "relationship" as const },
  { id: "approved", label: "approved", column: 8, dataType: "boolean" as const },
];

const initialConditionalFormats: readonly ConditionalFormatRule[] = [
  { id: "status-complete", fieldId: "status", operator: "equals", value: "Complete", format: { foreground: "#167a59" } },
  { id: "status-review", fieldId: "status", operator: "equals", value: "Review", format: { foreground: "#3e67af" } },
  { id: "status-flagged", fieldId: "status", operator: "equals", value: "Flagged", format: { foreground: "#a23131", background: "#fff1f1" } },
];

const presentationKey = "sheetbase-table:presentation:experiments";
const initialPresentation: TablePresentationState = {
  version: 3,
  theme: "system",
  conditionalFormats: initialConditionalFormats,
  formats: [],
  objects: [{ id: "conditional-formatting", kind: "inspector", placement: "right", size: 292, open: true, context: { fieldId: "status" } }],
  query: {},
  columns: fields.map((field) => ({ fieldId: field.id })),
  frozenColumns: 0,
  views: [],
  annotations: [],
};

function parseSelectionRange(label: string): CellRange | undefined {
  try {
    const [start, end = start] = label.split(":");
    return { start: parseAddress(start), end: parseAddress(end) };
  } catch { return undefined; }
}

function choosePresentationAdapter() {
  const mode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("presentation") : null;
  return mode === "http" ? createHttpPresentationAdapter("/api/presentation") : createLocalStoragePresentationAdapter();
}

function countGridCommit() {
  const state = globalThis as { __pagedGridRenders?: number };
  state.__pagedGridRenders = (state.__pagedGridRenders ?? 0) + 1;
}

function presentationStorageKey() {
  const user = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("user") : null;
  return user ? `${presentationKey}:${user}` : presentationKey;
}

export function PagedDemo() {
  const presentationAdapter = useMemo(choosePresentationAdapter, []);
  const [presentation, setPresentation] = useTablePresentationState(presentationStorageKey(), initialPresentation, presentationAdapter);
  const theme = useResolvedTheme(presentation.theme);
  const adapter = useMemo(() => new HttpPagedDataAdapter("/api/table"), []);
  const [totalRows, setTotalRows] = useState(1_000_000);
  const visibleFields = useMemo(() => {
    const byId = new Map(fields.map((field) => [field.id, field] as const));
    const visible: Array<(typeof fields)[number] & { column: number }> = [];
    for (const column of presentation.columns) {
      if (column.hidden) continue;
      const field = byId.get(column.fieldId);
      if (field) visible.push({ ...field, column: visible.length });
    }
    return visible;
  }, [presentation.columns]);
  const fieldIds = useMemo(() => visibleFields.map((field) => field.id), [visibleFields]);
  const fieldColumns = useMemo(() => new Set(visibleFields.map((field) => field.column)), [visibleFields]);
  const datasetHeader = useMemo(() => ({ fields: visibleFields }), [visibleFields]);
  const initialColumnWidths = useMemo(() => visibleFields.map((field) => presentation.columns.find((column) => column.fieldId === field.id)?.width ?? 170), [presentation.columns, visibleFields]);
  const formattingObject = presentation.objects.find((object) => object.id === "conditional-formatting");
  const formatField = formattingObject?.context?.fieldId ?? "status";
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "A1", range: "A1", input: "" });
  const updateObject = useCallback((patch: Partial<NonNullable<typeof formattingObject>>) => setPresentation((current) => ({ ...current, objects: current.objects.map((object) => object.id === "conditional-formatting" ? { ...object, ...patch } : object) })), [setPresentation]);
  const saveManualFormats = useCallback((formats: TablePresentationState["formats"]) => setPresentation((current) => JSON.stringify(current.formats) === JSON.stringify(formats) ? current : { ...current, formats }), [setPresentation]);
  const openFormatting = useCallback((fieldId?: string) => updateObject({ open: true, context: { fieldId: fieldId ?? fields[0].id } }), [updateObject]);
  const reportLoadError = useCallback((error: unknown) => console.error("Paged demo load failed", error), []);
  const updateColumns = useCallback((columns: readonly ColumnPresentation[]) => setPresentation((current) => ({ ...current, columns })), [setPresentation]);
  const setQuery = useCallback((query: DatasetQuery) => setPresentation((current) => ({ ...current, query })), [setPresentation]);
  const setFrozenColumns = useCallback((frozenColumns: number) => setPresentation((current) => ({ ...current, frozenColumns })), [setPresentation]);
  const moveColumn = useCallback((from: number, to: number) => updateColumns((() => {
    const next = [...presentation.columns.filter((column) => !column.hidden)];
    const [moving] = next.splice(from, 1);
    next.splice(to, 0, moving);
    const hidden = presentation.columns.filter((column) => column.hidden);
    return [...next, ...hidden];
  })()), [presentation.columns, updateColumns]);
  const saveColumnWidths = useCallback((widths: readonly number[]) => setPresentation((current) => ({ ...current, columns: current.columns.map((column) => {
    const visibleIndex = visibleFields.findIndex((field) => field.id === column.fieldId);
    return visibleIndex < 0 ? column : { ...column, width: widths[visibleIndex] };
  }) })), [setPresentation, visibleFields]);
  const setColumnVisibility = useCallback((fieldId: string, visible: boolean) => updateColumns(presentation.columns.map((column) => column.fieldId === fieldId ? { ...column, hidden: !visible } : column)), [presentation.columns, updateColumns]);
  const applyToolbarFormat = useCallback((format: Parameters<SpreadsheetHandle["applyFormat"]>[0]) => tableRef.current?.applyFormat(format), []);
  return <TableSurface theme={theme} className="paged-demo-surface" action={<button type="button" className="open-formatting" aria-label="Open conditional formatting" onClick={() => updateObject({ open: true })}><span>◩</span> Rules</button>} table={<div className="formatted-table"><TableFormattingToolbar selection={selection.range} format={selection.format} mixedFormats={selection.mixedFormats} onFormat={applyToolbarFormat} theme={theme} themeMode={presentation.theme} onThemeChange={(mode) => setPresentation((current) => ({ ...current, theme: mode }))} viewControls={<TableControls fields={fields} query={presentation.query} onQueryChange={setQuery} columns={presentation.columns} onColumnsChange={updateColumns} onFrozenColumnsChange={setFrozenColumns} theme={theme} />} /><Profiler id="paged-grid" onRender={countGridCommit}><PagedSpreadsheet
        theme={theme}
        key={fieldIds.join("|")}
    ref={tableRef}
    adapter={adapter}
    datasetId="experiments"
    fieldIds={fieldIds}
    rowCount={totalRows}
    columnCount={visibleFields.length}
    fieldColumns={fieldColumns}
    datasetHeader={datasetHeader}
    conditionalFormats={presentation.conditionalFormats}
    initialFormats={presentation.formats}
    onFormatsChange={saveManualFormats}
    query={presentation.query}
    onQueryChange={setQuery}
    frozenColumns={presentation.frozenColumns}
    initialColumnWidths={initialColumnWidths}
    onColumnWidthsChange={saveColumnWidths}
    onFrozenColumnsChange={setFrozenColumns}
    onColumnMove={moveColumn}
    onColumnVisibilityChange={setColumnVisibility}
    onTotalRowsChange={setTotalRows}
    showLoadTimings
    onSelectionChange={setSelection}
    onConditionalFormattingRequest={openFormatting}
    onLoadError={reportLoadError}
  /></Profiler></div>} objects={formattingObject?.open ? [{ id: formattingObject.id, placement: formattingObject.placement, size: formattingObject.size, onResize: (size) => updateObject({ size }), content: <ConditionalFormattingInspector fieldId={formatField} fields={fields} onFieldChange={(fieldId) => updateObject({ context: { fieldId } })} selectionRange={parseSelectionRange(selection.range)} selectionLabel={selection.range} rules={presentation.conditionalFormats} onRulesChange={(conditionalFormats) => setPresentation((current) => ({ ...current, conditionalFormats }))} onClose={() => updateObject({ open: false })} /> }] : []} />;
}

