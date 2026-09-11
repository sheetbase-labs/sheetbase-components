import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FormulaTokens } from "./FormulaTokens";
import { columnLabel, parseAddress } from "../engine/coordinates";
import { Worksheet, type BindingResolver } from "../engine/workbook";
import { RangeStore } from "../engine/range-store";
import type { CellBinding, CellFormat } from "../engine/types";
import {
  applyFormulaSuggestion,
  applyFormulaReference,
  cellKey,
  changeGridStructure,
  completeFormula,
  cycleAbsoluteReference,
  clearSelection,
  displayValue,
  fillSelection,
  formulaSuggestions,
  formulaReferenceRanges,
  formulaReferenceLabel,
  formulaErrorMessage,
  moveFormulaReference,
  moveSelection,
  normaliseSelection,
  applyTsvRows,
  parseTsv,
  pasteTsv,
  populatedColumnSelection,
  selectionLabel,
  selectionAddresses,
  selectionToTsv,
  sortGridRows,
  replaceAllText,
  validateTypedCell,
  type CellDataType,
  type GridPoint,
  type GridSelection,
  type FormulaReferenceSelection,
} from "../grid/model";
import {
  applyCellMutation,
  applyColumnWidthMutation,
  applyWorksheetMutation,
  cellMutation,
  cellChangesMutation,
  columnWidthMutation,
  formatMutation,
  isEmptyMutation,
  emitMutationAudit,
  mutationFormat,
  type GridMutation,
} from "../grid/mutations";
import { CellStore } from "../grid/cell-store";
import { resolveConditionalFormat, type ConditionalFormatRule } from "../grid/conditional-formatting";
import { columnDisplayDefaults, formatCellDisplay } from "./column-display";
import { removeAnnotation as removeFromAnnotations, setAnnotation as setAnnotationIn, type CellAnnotation } from "./annotations";
import { GridCell, type GridCellHandlers } from "./GridCell";
import {
  holdFieldWrite,
  type HeldFieldWrite,
} from "./held-field-writes";
import type { DatasetQuery, FilterClause, FilterOperator } from "../data";
import { conflictWriteKeys, fieldWritesForMutation, type MutationFieldWrite } from "../data";
import { buildFilterValue, ensureOperator, operatorLabel, operatorsForField } from "./filter-conditions";

const ROW_HEIGHT = 31;

const COLUMN_HEADER_HEIGHT = 31;
/** Cells per frame slice for large pastes; keeps the viewport responsive while pasting. */
const PASTE_CHUNK_CELLS = 20_000;

const ROW_HEADER_WIDTH = 50;
const defaultQuery: DatasetQuery = {};

export type SpreadsheetSelection = {
  address: string;
  range: string;
  input: string;
  error?: string;
  format?: Partial<CellFormat>;
  mixedFormats?: readonly (keyof CellFormat)[];
};

export type SpreadsheetViewport = Readonly<{
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}>;

export type SpreadsheetLoadingRange = Readonly<{ rowStart: number; rowEnd: number; columnStart: number; columnEnd: number }>;

export type SpreadsheetHandle = {
  undo(): void;
  redo(): void;
  setActiveInput(value: string): void;
  editActiveInput(value: string): void;
  commitEdit(): void;
  cancelEdit(): void;
  snapshot(): SpreadsheetState;
  insertRows(index?: number, count?: number): void;
  deleteRows(index?: number, count?: number): void;
  insertColumns(index?: number, count?: number): void;
  deleteColumns(index?: number, count?: number): void;
  autoFitColumn(column?: number): void;
  autoFitRow(row?: number): void;
  find(query: string): string | undefined;
  replaceAll(query: string, replacement: string): number;
  applyFormat(format: Partial<CellFormat>): void;
  focus(): void;
  hydrate(cells: ReadonlyMap<string, SpreadsheetHydrationCell>): void;
  /** Replace all cells (e.g. after a server query change) instead of merging. */
  replaceData(cells: ReadonlyMap<string, SpreadsheetHydrationCell>): void;
  /** Drops the write-state badge for an address (conflict resolutions); no undo history is touched. */
  clearWriteState(address: string): void;
  setFilter(filter: FilterClause): void;
  clearFilter(fieldId: string): void;
};

export type SpreadsheetState = Readonly<{
  data: ReadonlyMap<string, string>;
  formats: RangeStore<CellFormat>;
  columnWidths: readonly number[];
  rowHeights: readonly number[];
  selection: GridSelection;
  scroll: Readonly<{ top: number; left: number }>;
  frozenRows: number;
  frozenColumns: number;
  annotations?: readonly CellAnnotation[];
}>;

export type SpreadsheetHydrationCell = Readonly<{ display: string; binding: CellBinding }>;
export type SpreadsheetFormatEntry = Readonly<{ range: import("../engine").CellRange; value: CellFormat }>;
export type DatasetHeaderConfig = Readonly<{
  datasetId?: string;
  recordIdForRow?(row: number): string | undefined;
  fields: readonly Readonly<{ id: string; label: string; column: number; writable?: boolean; computed?: boolean; dataType?: CellDataType; required?: boolean; options?: readonly string[]; multiple?: boolean; unit?: string; precision?: number; numberFormat?: CellFormat["numberFormat"] }>[];
}>;
export type FieldWrite = Readonly<{ address: string; row: number; datasetId?: string; recordId?: string; fieldId: string; value: string }>;
export type WriteStatus = "pending" | "saved" | "conflict" | "failed";

/**
 * Maps a write-path failure to a per-write badge: conflicted records get
 * "conflict" (matched by record+field when the error lists them), anything
 * else is "failed". A bare 409 marks the write conflicted.
 */
function writeFailureStatus(error: unknown, write: FieldWrite): WriteStatus {
  const keys = conflictWriteKeys(error);
  if (keys === undefined) return "failed";
  if (keys === "all") return "conflict";
  return keys.has(JSON.stringify([write.recordId, write.fieldId])) ? "conflict" : "failed";
}

/** Checkbox editor for option fields marked `multiple`; commits a comma-joined value. */
function MultiOptionPicker({ options, current, onCommit, onCancel }: Readonly<{
  options: readonly string[];
  current: string;
  onCommit(value: string): void;
  onCancel(): void;
}>) {
  const validOptions = new Set(options);
  const selected = new Set(current.split(",").map((entry) => entry.trim()).filter((entry) => validOptions.has(entry)));
  const [picked, setPicked] = useState<Set<string>>(selected);
  return <div className="typed-options multi" role="group" aria-label="Choose values">
    {options.map((option) => <label key={option}>
      <input
        type="checkbox"
        checked={picked.has(option)}
        onChange={(event) => setPicked((currentPicked) => {
          const next = new Set(currentPicked);
          if (event.target.checked) next.add(option); else next.delete(option);
          return next;
        })}
      />
      <span>{option}</span>
    </label>)}
    <button className="multi-apply" onClick={() => onCommit([...picked].join(", "))}>Apply</button>
    <button onClick={onCancel}>Cancel</button>
  </div>;
}

/** "client": the engine parses and evaluates "=..." formulas locally (default). "host": the host owns calculation, so "=..." inputs are kept as inert text and computed values arrive through hydration. */
export type CalculationAuthority = "client" | "host";

export type SpreadsheetProps = {
  initialData: ReadonlyMap<string, string>;
  initialState?: SpreadsheetState;
  rowCount?: number;
  columnCount?: number;
  fieldColumns?: ReadonlySet<number>;
  computedColumns?: ReadonlySet<number>;
  frozenRows?: number;
  frozenColumns?: number;
  initialColumnWidths?: readonly number[];
  /** Per-row initial heights by index; absent entries (or the whole prop) mean automatic height. */
  initialRowHeights?: readonly number[];
  readOnlyRows?: ReadonlySet<number>;
  /** Blocks value/structure mutations; selection, copy, sorting and filtering stay live. */
  readOnly?: boolean;
  /** Resolved light/dark theme owned by the grid itself. */
  theme?: "light" | "dark";
  onSelectionChange?(selection: SpreadsheetSelection): void;
  onEditChange?(value: string): void;
  /** Audit/provenance hook: fired synchronously for every committed, undone, redone, or conflict-resolved mutation. Never blocks the grid when the sink throws. */
  onMutation?(mutation: GridMutation & { at: string; revision?: string }): void;
  onViewportChange?(viewport: SpreadsheetViewport): void;
  bindingResolver?: BindingResolver;
  fieldIds?: readonly (string | undefined)[];
  query?: DatasetQuery;
  onQueryChange?(query: DatasetQuery): void;
  sortMode?: "local" | "server";
  datasetHeader?: DatasetHeaderConfig;
  onFieldWrite?(write: FieldWrite): void | Promise<void>;
  /**
   * Batch variant of `onFieldWrite`: one call per committed grid mutation
   * (paste, clear, fill, replace-all, …) carrying every bound-cell write, so
   * the host can persist them in a single adapter commit. When absent, bulk
   * writes fall back to one `onFieldWrite` call each.
   */
  onFieldWrites?(writes: readonly FieldWrite[]): void | Promise<void>;
  /**
   * Intercepts the automatic authoritative field-write commit. Return "hold"
   * to keep the write local (visible, undoable) without committing — the host
   * owns persistence and reads/flushes the held writes via the handle.
   * Absent, or "commit", keeps the default immediate commit.
   */
  fieldWritePolicy?: (write: FieldWrite) => "commit" | "hold";
  /** Fired whenever the set of held writes changes (hold, replace, flush, discard). */
  onHeldFieldWritesChange?(writes: readonly FieldWrite[]): void;
  onRecordCreate?(record: Readonly<{ row: number; values: Readonly<Record<string, string>> }>): void | Promise<void>;
  onWriteStateChange?(address: string, status: WriteStatus): void;
  loadingRanges?: readonly SpreadsheetLoadingRange[];
  conditionalFormats?: readonly ConditionalFormatRule[];
  initialFormats?: readonly SpreadsheetFormatEntry[];
  onFormatsChange?(formats: readonly SpreadsheetFormatEntry[]): void;
  /** Per-cell provenance notes / review comments, rendered as an overlay marker. */
  initialAnnotations?: readonly CellAnnotation[];
  onAnnotationsChange?(annotations: readonly CellAnnotation[]): void;
  onConditionalFormattingRequest?(fieldId: string | undefined, column: number): void;
  onCellClickTiming?(milliseconds: number): void;
  onColumnMove?(from: number, to: number): void;
  onColumnVisibilityChange?(fieldId: string, visible: boolean): void;
  onFrozenColumnsChange?(count: number): void;
  onColumnWidthsChange?(widths: readonly number[]): void;
  onRowHeightsChange?(heights: readonly number[]): void;
  /** "host": the host supplies computed values for formula cells; the engine renders "=" inputs as inert text and never evaluates them. Default "client". */
  calculationAuthority?: CalculationAuthority;
  /** Replaces the default cell content. Return undefined to keep the built-in rendering. */
  renderCell?(context: SpreadsheetCellRenderContext): ReactNode | undefined;
  /** Custom in-cell editors; the first matching editor replaces the built-in input for that field. */
  customEditors?: readonly SpreadsheetCustomEditor[];
  /** Extra actions appended to the column and row context menus. */
  contextMenuActions?: readonly SpreadsheetMenuAction[];
};

function menuKeys(onClose: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), select, input"));
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next]!.focus();
  };
}

export type SpreadsheetCellRenderContext = Readonly<{
  address: string;
  point: GridPoint;
  display: string;
  field?: DatasetHeaderConfig["fields"][number];
  selected: boolean;
  active: boolean;
  loading: boolean;
}>;

export type SpreadsheetMenuAction = Readonly<{
  label: string;
  onSelect(context: { axis: "row" | "column"; index: number; fieldId?: string }): void;
}>;

export type SpreadsheetCustomEditorContext = Readonly<{
  point: GridPoint;
  address: string;
  field?: DatasetHeaderConfig["fields"][number];
  initialDraft: string;
  commit(value: string): void;
  cancel(): void;
}>;

export type SpreadsheetCustomEditor = Readonly<{
  matches(context: { point: GridPoint; field?: DatasetHeaderConfig["fields"][number] }): boolean;
  render(context: SpreadsheetCustomEditorContext): ReactNode;
}>;


function ColumnContextMenu({ x, y, column, field, query, onQueryChange, onAutoFit, onHide, onMove, onFreeze, onUnfreeze, onFormat, actions, onClose }: Readonly<{
  x: number; y: number; column: number;
  field?: DatasetHeaderConfig["fields"][number]; query: DatasetQuery;
  onQueryChange?(query: DatasetQuery): void; onAutoFit(): void; onHide?(): void;
  onMove?(direction: -1 | 1): void; onFreeze(): void; onUnfreeze?(): void; onFormat?(): void; onClose(): void;
  actions?: readonly SpreadsheetMenuAction[];
}>) {
  const existing = field ? query.filters?.find((filter) => filter.fieldId === field.id) : undefined;
  const [operator, setOperator] = useState<FilterOperator>(() => field ? ensureOperator(field, existing?.operator ?? "eq") : "eq");
  const [value, setValue] = useState(existing && !Array.isArray(existing.value) && existing.value != null ? String(existing.value) : "");
  const [value2, setValue2] = useState(existing?.operator === "between" && Array.isArray(existing.value) && existing.value[1] != null ? String(existing.value[1]) : "");
  const [values, setValues] = useState<readonly string[]>(existing?.operator === "in" && Array.isArray(existing.value) ? existing.value.map(String) : []);
  const sorts = query.sort ?? [];
  const sortIndex = field ? sorts.findIndex((sort) => sort.fieldId === field.id) : -1;
  const setSort = (direction?: "asc" | "desc") => {
    if (!field) return;
    const other = sorts.filter((sort) => sort.fieldId !== field.id);
    onQueryChange?.({ ...query, sort: direction ? [...other, { fieldId: field.id, direction }] : other });
  };
  const applyFilter = () => {
    if (!field) return;
    const other = (query.filters ?? []).filter((filter) => filter.fieldId !== field.id);
    const built = buildFilterValue(field, operator, { value, value2, values });
    if (built === undefined) return;
    onQueryChange?.({ ...query, filters: [...other, { fieldId: field.id, operator, ...built }] });
  };
  const clearFilter = () => field && onQueryChange?.({ ...query, filters: (query.filters ?? []).filter((filter) => filter.fieldId !== field.id) });
  const operators = field ? operatorsForField(field) : [];
  return <div
    className="column-menu"
    style={{ left: x, top: y }}
    role="menu"
    aria-label={`${field?.label ?? columnLabel(column)} column menu`}
    tabIndex={-1}
    autoFocus
    onKeyDown={menuKeys(onClose)}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <header><div><strong>{field?.label ?? columnLabel(column)}</strong><small>{field?.dataType ?? "column"}{sortIndex >= 0 ? ` · sort ${sortIndex + 1}` : ""}</small></div><button aria-label="Close menu" onClick={onClose}>×</button></header>
    {field && <>
      <section><label>Sort</label><div className="column-menu-segment"><button className={sorts[sortIndex]?.direction === "asc" ? "active" : ""} onClick={() => setSort("asc")}>↑ Asc</button><button className={sorts[sortIndex]?.direction === "desc" ? "active" : ""} onClick={() => setSort("desc")}>↓ Desc</button><button onClick={() => setSort()}>Clear</button></div></section>
      <section><div className="column-menu-label"><label>Filter</label>{(query.filters?.length ?? 0) > 1 && <select aria-label="Filter logic" value={query.filterLogic ?? "and"} onChange={(event) => onQueryChange?.({ ...query, filterLogic: event.target.value as "and" | "or" })}><option value="and">Match all</option><option value="or">Match any</option></select>}</div>
        <select aria-label="Filter condition" value={operator} onChange={(event) => setOperator(event.target.value as FilterOperator)}>{operators.map((entry) => <option key={entry} value={entry}>{operatorLabel(entry, field)}</option>)}</select>
        {(operator === "isNull" || operator === "notNull") ? null
          : operator === "in" && field.options ? <select multiple aria-label="Filter values" size={Math.min(4, field.options.length)} value={[...values]} onChange={(event) => setValues(Array.from(event.target.selectedOptions, (option) => option.value))}>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : operator === "between" ? <div className="column-menu-between">
            <input aria-label="Minimum value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : field.dataType === "datetime" ? "datetime-local" : "text"} value={value} onChange={(event) => setValue(event.target.value)} />
            <input aria-label="Maximum value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : field.dataType === "datetime" ? "datetime-local" : "text"} value={value2} onChange={(event) => setValue2(event.target.value)} />
          </div>
          : operator === "withinLastDays" ? <input aria-label="Number of days" type="number" min={1} value={value} onChange={(event) => setValue(event.target.value)} />
          : field.options && (operator === "eq" || operator === "neq") ? <select aria-label="Filter value" value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose…</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.dataType === "boolean" ? <select aria-label="Filter value" value={value} onChange={(event) => setValue(event.target.value)}><option value="true">True</option><option value="false">False</option></select>
          : <input aria-label="Filter value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : field.dataType === "datetime" ? "datetime-local" : "text"} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && applyFilter()} />}
        <div className="column-menu-actions"><button className="primary" onClick={applyFilter}>Apply</button>{existing && <button onClick={clearFilter}>Remove</button>}</div>
      </section>
    </>}
    <section className="column-menu-list"><button onClick={onAutoFit}>Auto-fit width</button>{onMove && <><button onClick={() => onMove(-1)}>Move left</button><button onClick={() => onMove(1)}>Move right</button></>}{onHide && <button onClick={onHide}>Hide column</button>}<button onClick={onFreeze}>Freeze through column</button>{onUnfreeze && <button onClick={onUnfreeze}>Unfreeze columns</button>}{onFormat && <button onClick={onFormat}>Conditional formatting…</button>}{actions?.map((action) => <button key={action.label} onClick={() => { action.onSelect({ axis: "column", index: column, fieldId: field?.id }); onClose(); }}>{action.label}</button>)}</section>
  </div>;
}


function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.row === b.row && a.column === b.column;
}

export const Spreadsheet = forwardRef<SpreadsheetHandle, SpreadsheetProps>(function Spreadsheet({
  initialData,
  initialState,
  rowCount = 1_000,
  columnCount = 18,
  fieldColumns: _fieldColumns = new Set(),
  calculationAuthority = "client",
  computedColumns: _computedColumns = new Set(),
  frozenRows: initialFrozenRows = 0,
  frozenColumns: initialFrozenColumns = 0,
  initialColumnWidths,
  initialRowHeights,
  readOnlyRows = new Set(),
  readOnly = false,
  theme = "light",
  onSelectionChange,
  onEditChange,
  onMutation,
  onViewportChange,
  bindingResolver,
  fieldIds = [],
  query = defaultQuery,
  onQueryChange,
  sortMode = "local",
  datasetHeader,
  onFieldWrite,
  onFieldWrites,
  fieldWritePolicy,
  onHeldFieldWritesChange,
  onRecordCreate,
  onWriteStateChange,
  loadingRanges = [],
  conditionalFormats = [],
  initialAnnotations,
  onAnnotationsChange,
  initialFormats = [],
  onFormatsChange,
  onConditionalFormattingRequest,
  onCellClickTiming,
  onColumnMove,
  onColumnVisibilityChange,
  onFrozenColumnsChange,
  onColumnWidthsChange,
  onRowHeightsChange,
  renderCell,
  customEditors,
  contextMenuActions,
}, forwardedRef) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragSelecting = useRef(false);
  const past = useRef<GridMutation[]>([]);
  const future = useRef<GridMutation[]>([]);
  const fillOrigin = useRef<GridSelection | null>(null);
  const fillTargetRef = useRef<GridPoint | null>(null);
  const pasteValuesNext = useRef(false);
  const structuredRangesRef = useRef(new Map<string, string>());
  const sortBaselineRef = useRef<ReadonlyMap<string, string> | undefined>(undefined);
  const [data, setData] = useState<ReadonlyMap<string, string>>(() => CellStore.from(initialState?.data ?? initialData));
  const worksheetRef = useRef<Worksheet | null>(null);
  if (!worksheetRef.current) {
    const initialWorksheet = new Worksheet(
      bindingResolver,
      undefined,
      (expression) =>
        expression.replace(/\[([^\]]+)\]/g, (token, fieldId: string) => structuredRangesRef.current.get(fieldId) ?? token),
      { formulaMode: calculationAuthority === "host" ? "literal" : "evaluate" },
    );
    for (const [address, input] of initialState?.data ?? initialData) initialWorksheet.setInput(address, input);
    worksheetRef.current = initialWorksheet;
  }
  worksheetRef.current.setFormulaMode(calculationAuthority === "host" ? "literal" : "evaluate");
  const [formats, setFormats] = useState(() => {
    if (initialState) return initialState.formats.clone();
    const store = new RangeStore<CellFormat>();
    for (const entry of initialFormats) store.write(entry.range, entry.value);
    return store;
  });
  const [annotations, setAnnotations] = useState<readonly CellAnnotation[]>(() =>
    initialState?.annotations ?? initialAnnotations ?? [],
  );
  const [selection, setSelection] = useState<GridSelection>(initialState?.selection ?? {
    anchor: { row: 5, column: 2 },
    focus: { row: 5, column: 2 },
  });
  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  const [editing, setEditing] = useState<GridPoint | null>(null);
  const [draft, setDraft] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [formulaReference, setFormulaReference] = useState<FormulaReferenceSelection | null>(null);
  const [fillTarget, setFillTarget] = useState<GridPoint | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>(() => initialState
    ? [...initialState.columnWidths]
    : Array.from({ length: columnCount }, (_, index) => initialColumnWidths?.[index] ?? (index < 7 ? 170 : 140)));
  const [rowHeights, setRowHeights] = useState<number[]>(() => initialState?.rowHeights
    ? [...initialState.rowHeights]
    : Array.from({ length: rowCount }, (_, row) => initialRowHeights?.[row] ?? ROW_HEIGHT));
  const [frozenRowCount, setFrozenRowCount] = useState(initialState?.frozenRows ?? initialFrozenRows);
  const [frozenColumnCount, setFrozenColumnCount] = useState(initialState?.frozenColumns ?? initialFrozenColumns);
  const [contextMenu, setContextMenu] = useState<{ axis: "row" | "column"; index: number; x: number; y: number }>();
  const closeContextMenu = useCallback(() => {
    setContextMenu(undefined);
    viewportRef.current?.focus();
  }, []);
  const [findPanel, setFindPanel] = useState<"find" | "replace">();
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [validationError, setValidationError] = useState<string>();
  const [writeStates, setWriteStates] = useState(new Map<string, Readonly<{ status: WriteStatus; write: FieldWrite; before?: string }>>());
  const [announcement, setAnnouncement] = useState("");
  const announcerTimer = useRef<number | undefined>(undefined);
  const announce = useCallback((message: string) => {
    window.clearTimeout(announcerTimer.current);
    announcerTimer.current = window.setTimeout(() => setAnnouncement(message), 150);
  }, []);
  const writeStateTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const clickTimingFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    for (const timer of writeStateTimers.current.values()) clearTimeout(timer);
    writeStateTimers.current.clear();
  }, []);
  useEffect(() => () => {
    if (clickTimingFrame.current !== undefined && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(clickTimingFrame.current);
  }, []);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: (row) => rowHeights[row] ?? ROW_HEIGHT,
    overscan: 8,
    useFlushSync: false,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: (column) => columnWidths[column] ?? 140,
    overscan: 3,
    useFlushSync: false,
  });

  const worksheet = worksheetRef.current;
  const formulaFields = useMemo(() => Array.from({ length: columnCount }, (_, column) => ({
    column,
    label: data.get(cellKey({ row: 0, column })) ?? columnLabel(column),
  })), [columnCount, data]);
  const formulaRegions = useMemo(() => {
    const rowsByColumn = new Map<number, number[]>();
    for (const [address, value] of data) {
      if (value === "") continue;
      try {
        const point = parseAddress(address);
        if (editing && samePoint(point, editing)) continue;
        const rows = rowsByColumn.get(point.column) ?? [];
        rows.push(point.row);
        rowsByColumn.set(point.column, rows);
      } catch { /* Ignore non-cell keys. */ }
    }
    const regions: { label: string; reference?: string; detail: string; distance: number }[] = [];
    for (const [column, unsortedRows] of rowsByColumn) {
      const rows = [...new Set(unsortedRows)].sort((a, b) => a - b);
      let start = rows[0];
      let previous = rows[0];
      const add = (end: number) => {
        if (end - start < 1) return;
        const label = `${columnLabel(column)}${start + 1}:${columnLabel(column)}${end + 1}`;
        const configuredField = datasetHeader?.fields.find((item) => item.column === column);
        const field = configuredField?.label ?? formulaFields[column]?.label;
        regions.push({
          label,
          reference: configuredField ? `[${configuredField.id}]` : undefined,
          detail: `${field && field !== columnLabel(column) ? `${field} · ` : ""}${end - start + 1} populated cells`,
          distance: editing ? Math.abs(column - editing.column) + Math.abs(start - editing.row) / 100 : column,
        });
      };
      for (const row of rows.slice(1)) {
        if (row !== previous + 1) { add(previous); start = row; }
        previous = row;
      }
      add(previous);
    }
    return regions.sort((a, b) => a.distance - b.distance).slice(0, 12);
  }, [data, datasetHeader, editing, formulaFields]);
  const structuredRanges = useMemo(() => new Map<string, string>(formulaRegions.flatMap((region) => {
    const fieldId = /^\[([^\]]+)\]$/.exec(region.reference ?? "")?.[1];
    return fieldId ? [[fieldId, region.label]] : [];
  })), [formulaRegions]);
  useEffect(() => { structuredRangesRef.current = structuredRanges; }, [structuredRanges]);
  const structuredRangeSignature = [...structuredRanges].map(([field, region]) => `${field}:${region}`).join("|");
  const suggestions = useMemo(
    () => editing ? formulaSuggestions(draft, editing.row, formulaFields, formulaRegions) : [],
    [draft, editing, formulaFields, formulaRegions],
  );
  const referencedRanges = useMemo(
    () => editing ? formulaReferenceRanges(draft).slice(0, 24) : [],
    [draft, editing],
  );
  const suggestedRange = useMemo(() => {
    const suggestion = suggestions[0];
    if (!editing || formulaReference || referencedRanges.length > 0 || suggestion?.kind !== "region") return null;
    const preview = formulaReferenceRanges(`=${suggestion.previewRange ?? suggestion.replacement}`)[0];
    return preview ?? null;
  }, [editing, formulaReference, referencedRanges.length, suggestions]);
  const semanticReferences = useMemo(() => {
    if (!editing) return [];
    return [...draft.matchAll(/\[([^\]]+)\]/g)].flatMap((match) => {
      const label = structuredRanges.get(match[1]);
      const reference = label ? formulaReferenceRanges(`=${label}`)[0] : undefined;
      return reference ? [reference] : [];
    });
  }, [draft, editing, structuredRanges, structuredRangeSignature]);
  const displayedReferenceRanges = [
    ...(suggestedRange ? [suggestedRange] : []),
    ...semanticReferences,
    ...referencedRanges,
  ];
  const editingField = editing ? datasetHeader?.fields.find((field) => field.column === editing.column) : undefined;
  const activeCustomEditor = editing && customEditors ? customEditors.find((editor) => editor.matches({ point: editing, field: editingField })) : undefined;
  const columnOffsets = useMemo(() => {
    const offsets = [0];
    for (const width of columnWidths) offsets.push(offsets[offsets.length - 1] + width);
    return offsets;
  }, [columnWidths]);
  const rowOffsets = useMemo(() => {
    const offsets = [0];
    for (const height of rowHeights) offsets.push(offsets[offsets.length - 1] + height);
    return offsets;
  }, [rowHeights]);
  // Frozen columns ride the imperative --sheet-scroll-left custom property
  // (set in onScroll), the same way frozen rows ride --sheet-scroll-top — so
  // scroll never needs a React state update just to reposition them.
  const columnLeft = (column: number, extra = 0): number | string => {
    const base = ROW_HEADER_WIDTH + columnOffsets[column] + extra;
    return column < frozenColumnCount ? `calc(var(--sheet-scroll-left, 0px) + ${base}px)` : base;
  };
  const datasetHeaderHeight = 0;
  const contentWidth = ROW_HEADER_WIDTH + columnVirtualizer.getTotalSize();
  const contentHeight = COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const viewportRange = {
    rowStart: virtualRows[0]?.index ?? 0,
    rowEnd: virtualRows.at(-1)?.index ?? 0,
    columnStart: virtualColumns[0]?.index ?? 0,
    columnEnd: virtualColumns.at(-1)?.index ?? 0,
  };
  const visibleRows = [...new Set([
    ...Array.from({ length: Math.min(frozenRowCount, rowCount) }, (_, row) => row),
    ...virtualRows.map((item) => item.index),
  ])];
  const renderColumns = [...new Set([
    ...Array.from({ length: Math.min(frozenColumnCount, columnCount) }, (_, column) => column),
    ...virtualColumns.map((item) => item.index),
  ])].map((index) => ({ index }));
  const range = normaliseSelection(selection);
  useEffect(() => {
    const cells = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    const scope = cells === 1 ? selectionLabel(selection) : `${cells.toLocaleString()} cells selected, ${selectionLabel(selection)}`;
    announce(scope);
  }, [announce, range.bottom, range.left, range.right, range.top, selection]);
  const announcedWrites = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [address, state] of writeStates) {
      if (announcedWrites.current.has(address)) continue;
      announcedWrites.current.add(address);
      announce(state.status === "saved" ? "Saved" : state.status === "conflict" ? "Save conflict" : state.status === "failed" ? "Save failed" : "Saving");
      break;
    }
  }, [announce, writeStates]);
  const previewRange = fillTarget ? {
    top: Math.min(range.top, fillTarget.row),
    bottom: Math.max(range.bottom, fillTarget.row),
    left: Math.min(range.left, fillTarget.column),
    right: Math.max(range.right, fillTarget.column),
  } : range;

  // Spill-aware selection: resolve the active cell through the worksheet's
  // spill ownership during render (no engine state in React state) and box
  // the full spill extent for the dashed spill-range outline below.
  const activeKey = cellKey(selection.focus);
  const spillOwner = worksheet.spills.owner(activeKey);
  const spillBox = (() => {
    if (!spillOwner) return undefined;
    const addresses = worksheet.spills.range(spillOwner);
    if (addresses.length < 2) return undefined;
    let top = rowCount, left = columnCount, bottom = -1, right = -1;
    for (const address of addresses) {
      try {
        const point = parseAddress(address);
        if (point.row < 0 || point.column < 0 || point.row >= rowCount || point.column >= columnCount) continue;
        top = Math.min(top, point.row); left = Math.min(left, point.column);
        bottom = Math.max(bottom, point.row); right = Math.max(right, point.column);
      } catch { /* Ignore non-cell keys. */ }
    }
    return bottom >= top && right >= left ? { top, left, bottom, right } : undefined;
  })();

  const pushHistory = useCallback((mutation: GridMutation) => {
    if (isEmptyMutation(mutation)) return false;
    past.current.push(mutation);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    emitMutationAudit(onMutation, mutation);
    return true;
  }, [onMutation]);

  const [heldWrites, setHeldWrites] = useState<ReadonlyMap<string, HeldFieldWrite>>(() => new Map());
  const heldWritesRef = useRef(heldWrites);
  useEffect(() => { heldWritesRef.current = heldWrites; }, [heldWrites]);
  /** Authoritative write pipeline: write-state badge tracking per address. */
  const updateWriteState = useCallback((entry: Readonly<{ write: FieldWrite; before?: string }>, status: WriteStatus) => {
    const { write, before } = entry;
    const existingTimer = writeStateTimers.current.get(write.address);
    if (existingTimer) clearTimeout(existingTimer);
    writeStateTimers.current.delete(write.address);
    setWriteStates((current) => new Map(current).set(write.address, { status, write, before }));
    onWriteStateChange?.(write.address, status);
    if (status === "saved") {
      writeStateTimers.current.set(write.address, setTimeout(() => {
        writeStateTimers.current.delete(write.address);
        setWriteStates((current) => {
          if (current.get(write.address)?.status !== "saved") return current;
          const next = new Map(current);
          next.delete(write.address);
          return next;
        });
      }, 1400));
    }
  }, [onWriteStateChange]);

  const emitFieldWrite = useCallback((write: FieldWrite, before?: string) => {
    if (!onFieldWrite) return;
    const entry = { write, before };
    updateWriteState(entry, "pending");
    Promise.resolve(onFieldWrite(write)).then(
      () => updateWriteState(entry, "saved"),
      (error: unknown) => updateWriteState(entry, writeFailureStatus(error, write)),
    );
  }, [onFieldWrite, updateWriteState]);

  /**
   * Bulk write dispatch for grid mutations (paste, clear, fill, replace-all):
   * held-policy writes enqueue exactly like the single-edit path, and the rest
   * reach the host in one `onFieldWrites` call (one adapter commit) or one
   * `onFieldWrite` call each when the host only implements the single form.
   */
  const emitFieldWrites = useCallback((entries: readonly MutationFieldWrite[]) => {
    if (!entries.length || (!onFieldWrite && !onFieldWrites)) return;
    let held = heldWritesRef.current;
    let heldChanged = false;
    const immediate: MutationFieldWrite[] = [];
    for (const entry of entries) {
      if (fieldWritePolicy?.(entry.write) === "hold") {
        held = holdFieldWrite(held, entry.write, entry.before);
        heldChanged = true;
      } else {
        immediate.push(entry);
      }
    }
    if (heldChanged) {
      heldWritesRef.current = held;
      setHeldWrites(held);
      onHeldFieldWritesChange?.([...held.values()].map((entry) => entry.write));
    }
    if (!immediate.length) return;
    const settle = (entry: MutationFieldWrite, error: unknown) => updateWriteState(entry, error === undefined ? "saved" : writeFailureStatus(error, entry.write));
    for (const entry of immediate) updateWriteState(entry, "pending");
    if (onFieldWrites) {
      Promise.resolve(onFieldWrites(immediate.map((entry) => entry.write))).then(
        () => { for (const entry of immediate) settle(entry, undefined); },
        (error) => { for (const entry of immediate) settle(entry, error); },
      );
      return;
    }
    for (const entry of immediate) {
      Promise.resolve(onFieldWrite!(entry.write)).then(
        () => settle(entry, undefined),
        (error) => settle(entry, error),
      );
    }
  }, [fieldWritePolicy, onFieldWrite, onFieldWrites, onHeldFieldWritesChange, updateWriteState]);

  const runFieldWrite = useCallback((write: FieldWrite, before?: string) => {
    if (!onFieldWrite) return;
    if (fieldWritePolicy?.(write) === "hold") {
      // Field-write policy: the write stays local (visible, undoable) and the
      // host owns persistence. A re-edit of the same cell replaces its held
      // write; the host flushes or discards through the handle.
      const next = holdFieldWrite(heldWritesRef.current, write, before);
      heldWritesRef.current = next;
      setHeldWrites(next);
      onHeldFieldWritesChange?.([...next.values()].map((entry) => entry.write));
      return;
    }
    emitFieldWrite(write, before);
  }, [emitFieldWrite, fieldWritePolicy, onFieldWrite, onHeldFieldWritesChange]);

  /**
   * Applies a grid mutation locally and emits its bound-cell field writes.
   * `emitFieldWrites: false` is for mutations that must not persist — the
   * single-edit path dispatches its own write, and structure/sort mutations
   * move values between addresses so row→record identity no longer holds.
   */
  const commitMutation = useCallback((mutation: GridMutation, options?: { emitFieldWrites?: boolean }) => {
    if (!pushHistory(mutation)) return;
    const writes = options?.emitFieldWrites === false ? [] : fieldWritesForMutation(mutation, datasetHeader);
    applyWorksheetMutation(worksheet, mutation);
    setData((current) => applyCellMutation(current, mutation));
    emitFieldWrites(writes);
  }, [datasetHeader, emitFieldWrites, pushHistory, worksheet]);

  const commit = useCallback((next: ReadonlyMap<string, string>, label = "Edit cells", affectedAddresses?: Iterable<string>, options?: { emitFieldWrites?: boolean }) => {
    const mutation = cellMutation(label, data, next, affectedAddresses);
    commitMutation(mutation, options);
  }, [commitMutation, data]);


  // Declarative per-column display defaults (units, precision, number format)
  // from the host's dataset header — display only, never stored values.
  const columnDisplay = useMemo(
    () => columnDisplayDefaults(datasetHeader?.fields ?? []),
    [datasetHeader],
  );

  // Lookups hoisted out of the per-cell render loop: field metadata,
  // annotations, and field→column were all linear finds per cell per render.
  const fieldByColumn = useMemo(
    () => new Map((datasetHeader?.fields ?? []).map((field) => [field.column, field])),
    [datasetHeader],
  );
  const annotationByAddress = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.address, annotation])),
    [annotations],
  );
  const columnByFieldId = useMemo(
    () => new Map(fieldIds.flatMap((fieldId, column) => fieldId === undefined ? [] : [[fieldId, column] as const])),
    [fieldIds],
  );

  // A bound grid owns no row identity: rows are server records, so structure
  // ops and local sort (which only move the data map) would desync
  // row→record mapping. `recordIdForRow` presence is the bound signal — a
  // header passed for display metadata alone leaves the grid unbound.
  const bound = datasetHeader?.recordIdForRow !== undefined;

  const canEdit = useCallback((point: GridPoint) => {
    if (readOnly) return false;
    if (readOnlyRows.has(point.row)) return false;
    const field = fieldByColumn.get(point.column);
    return field?.writable !== false;
  }, [fieldByColumn, readOnly, readOnlyRows]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(previous);
    applyWorksheetMutation(worksheet, previous, "backward");
    setData((current) => applyCellMutation(current, previous, "backward"));
    setFormats((current) => mutationFormat(current, previous, "backward"));
    setColumnWidths((current) => applyColumnWidthMutation(current, previous, "backward"));
    emitMutationAudit(onMutation, previous);
  }, [onMutation, worksheet]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(next);
    applyWorksheetMutation(worksheet, next);
    setData((current) => applyCellMutation(current, next));
    setFormats((current) => mutationFormat(current, next));
    setColumnWidths((current) => applyColumnWidthMutation(current, next));
    emitMutationAudit(onMutation, next);
  }, [onMutation, worksheet]);

  const writeActiveCell = useCallback((value: string) => {
    if (readOnly || !canEdit(selection.focus)) return;
    const key = cellKey(selection.focus);
    commitMutation(cellChangesMutation("Edit cell", [{
      address: key,
      before: data.get(key),
      after: value === "" ? undefined : value,
    }]));
  }, [canEdit, commitMutation, data, readOnly, selection.focus]);

  const applyFormat = useCallback((patch: Partial<CellFormat>) => {
    if (readOnly) return;
    const next = formats.clone();
    const current = next.get(selection.focus) ?? {};
    next.write({
      start: { row: range.top, column: range.left },
      end: { row: range.bottom, column: range.right },
    }, { ...current, ...patch });
    const mutation = formatMutation("Format range", formats, next);
    if (pushHistory(mutation)) setFormats(next);
  }, [formats, pushHistory, range.bottom, range.left, range.right, range.top, readOnly, selection.focus]);

  const hydrate = useCallback((cells: ReadonlyMap<string, SpreadsheetHydrationCell>) => {
    const changes = [...cells].map(([address, cell]) => ({ address, after: cell.display }));
    for (const [address, cell] of cells) worksheet.set(address, cell.binding);
    setData((current) => applyCellMutation(current, cellChangesMutation("Hydrate page", changes)));
  }, [worksheet]);

  /** Swap the whole dataset for a new query result, dropping rows no longer present. */
  const replaceData = useCallback((cells: ReadonlyMap<string, SpreadsheetHydrationCell>) => {
    const next = new Map<string, string>();
    for (const [address, cell] of cells) {
      worksheet.set(address, cell.binding);
      if (cell.display) next.set(address, cell.display);
    }
    setData(next);
  }, [worksheet]);

  const setFilter = useCallback((filter: FilterClause) => {
    onQueryChange?.({ ...query, filters: [...(query.filters ?? []).filter((item) => item.fieldId !== filter.fieldId), filter] });
  }, [onQueryChange, query]);

  const clearFilter = useCallback((fieldId: string) => {
    onQueryChange?.({ ...query, filters: (query.filters ?? []).filter((item) => item.fieldId !== fieldId) });
  }, [onQueryChange, query]);

  useEffect(() => {
    if (bindingResolver) worksheet.setBindingResolver(bindingResolver);
  }, [bindingResolver, worksheet]);

  useEffect(() => {
    worksheet.renormalizeFormulas();
  }, [structuredRangeSignature, worksheet]);

  useEffect(() => {
    const address = cellKey(selection.focus);
    const input = data.get(address) ?? "";
    const value = input.startsWith("=") ? displayValue(worksheet, selection.focus) : input;
    const properties: readonly (keyof CellFormat)[] = ["foreground", "background", "fontWeight", "horizontalAlign", "numberFormat"];
    const overlaps = formats.query({ start: { row: range.top, column: range.left }, end: { row: range.bottom, column: range.right } });
    const area = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    const covered = overlaps.reduce((sum, entry) => {
      const top = Math.max(range.top, Math.min(entry.range.start.row, entry.range.end.row));
      const bottom = Math.min(range.bottom, Math.max(entry.range.start.row, entry.range.end.row));
      const left = Math.max(range.left, Math.min(entry.range.start.column, entry.range.end.column));
      const right = Math.min(range.right, Math.max(entry.range.start.column, entry.range.end.column));
      return sum + Math.max(0, bottom - top + 1) * Math.max(0, right - left + 1);
    }, 0);
    const mixedFormats = properties.filter((property) => {
      const values = new Set<string | undefined>(overlaps.map((entry) => JSON.stringify(entry.value[property])));
      if (covered < area) values.add(undefined);
      return values.size > 1;
    });
    onSelectionChange?.({ address, range: selectionLabel(selection), input, error: formulaErrorMessage(value), format: formats.get(selection.focus) ?? {}, mixedFormats });
  }, [data, formats, onSelectionChange, range.bottom, range.left, range.right, range.top, selection, worksheet]);

  useEffect(() => {
    const finishDrag = () => {
      dragSelecting.current = false;
      if (!readOnly && fillOrigin.current && fillTargetRef.current) {
        const filled = fillSelection(data, fillOrigin.current, fillTargetRef.current, rowCount, columnCount, canEdit);
        commit(filled.data, "Autofill", selectionAddresses(filled.selection));
        setSelection(filled.selection);
      }
      fillOrigin.current = null;
      fillTargetRef.current = null;
      setFillTarget(null);
    };
    window.addEventListener("pointerup", finishDrag);
    return () => window.removeEventListener("pointerup", finishDrag);
  }, [canEdit, columnCount, commit, data, readOnly, rowCount]);

  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidths]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeights, rowVirtualizer]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", close, { once: true });
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!initialState || !viewportRef.current) return;
    viewportRef.current.scrollTop = initialState.scroll.top;
    viewportRef.current.scrollLeft = initialState.scroll.left;
  }, []);

  useEffect(() => {
    onViewportChange?.(viewportRange);
  }, [
    onViewportChange,
    viewportRange.columnEnd,
    viewportRange.columnStart,
    viewportRange.rowEnd,
    viewportRange.rowStart,
  ]);

  const reveal = useCallback((point: GridPoint) => {
    rowVirtualizer.scrollToIndex(point.row, { align: "auto" });
    columnVirtualizer.scrollToIndex(point.column, { align: "auto" });
  }, [columnVirtualizer, rowVirtualizer]);

  const move = useCallback((delta: GridPoint, extend: boolean) => {
    const current = selectionRef.current;
    if (extend && samePoint(current.anchor, current.focus)) {
      // First Shift+arrow from a spill child covers the whole spill extent,
      // so keyboard expansion starts from the dynamic array, not one cell.
      const owner = worksheet.spills.owner(cellKey(current.focus));
      const addresses = owner ? worksheet.spills.range(owner) : [];
      if (addresses.length > 1) {
        let top = rowCount, left = columnCount, bottom = -1, right = -1;
        for (const address of addresses) {
          try {
            const point = parseAddress(address);
            if (point.row < 0 || point.column < 0 || point.row >= rowCount || point.column >= columnCount) continue;
            top = Math.min(top, point.row); left = Math.min(left, point.column);
            bottom = Math.max(bottom, point.row); right = Math.max(right, point.column);
          } catch { /* Ignore non-cell keys. */ }
        }
        if (bottom >= top && right >= left) {
          const spillSelection = { anchor: { row: top, column: left }, focus: { row: bottom, column: right } };
          setSelection(spillSelection);
          queueMicrotask(() => reveal(spillSelection.focus));
          return;
        }
      }
    }
    const next = moveSelection(current, delta, rowCount, columnCount, extend);
    setSelection(next);
    queueMicrotask(() => reveal(next.focus));
  }, [columnCount, reveal, rowCount, worksheet]);

  const beginEdit = useCallback((point: GridPoint, replaceWith?: string) => {
    if (!canEdit(point)) return;
    setSelection({ anchor: point, focus: point });
    setEditing(point);
    setDraft(replaceWith ?? data.get(cellKey(point)) ?? "");
    setSuggestionIndex(0);
    setFormulaReference(null);
    setValidationError(undefined);
  }, [canEdit, data]);

  const finishEdit = useCallback((save: boolean, movement?: GridPoint, explicitDraft?: string) => {
    if (!editing) return;
    if (save && readOnly) { setEditing(null); setFormulaReference(null); queueMicrotask(() => viewportRef.current?.focus()); return; }
    if (save) {
      const key = cellKey(editing);
      const completedDraft = completeFormula(explicitDraft ?? draft);
      const field = datasetHeader?.fields.find((item) => item.column === editing.column);
      const invalid = field ? validateTypedCell(completedDraft, field.dataType, field.required, field.options) : undefined;
      if (invalid) { setValidationError(invalid); return; }
      const rowWasBlank = datasetHeader ? datasetHeader.fields.every((item) => !(data.get(cellKey({ row: editing.row, column: item.column })) ?? "").trim()) : false;
      const before = data.get(key);
      // The single-edit write goes through runFieldWrite below, which carries
      // the blank-row record-create semantics — commitMutation must not also
      // dispatch a bulk write for this mutation.
      commitMutation(cellChangesMutation("Edit cell", [{
        address: key,
        before,
        after: completedDraft === "" ? undefined : completedDraft,
      }]), { emitFieldWrites: false });
      const recordId = datasetHeader?.recordIdForRow?.(editing.row);
      // Skip the write entirely when the edit changed nothing — an unchanged
      // commit still bumps the server revision and pollutes held writes.
      if (field && (!rowWasBlank || recordId) && (before ?? "") !== completedDraft) runFieldWrite({ address: key, row: editing.row, datasetId: datasetHeader?.datasetId, recordId, fieldId: field.id, value: completedDraft }, before);
      if (rowWasBlank && datasetHeader && completedDraft !== "") {
        const values = Object.fromEntries(datasetHeader.fields.map((item) => [item.id, item.column === editing.column ? completedDraft : data.get(cellKey({ row: editing.row, column: item.column })) ?? ""]));
        if (onRecordCreate) Promise.resolve(onRecordCreate({ row: editing.row, values })).catch(() => undefined);
      }
    }
    setEditing(null);
    setFormulaReference(null);
    if (movement) move(movement, false);
    queueMicrotask(() => viewportRef.current?.focus());
  }, [commitMutation, data, datasetHeader, draft, editing, move, onRecordCreate, readOnly, runFieldWrite]);

  const editActiveInput = useCallback((value: string) => {
    if (readOnly) return;
    if (editing) setDraft(value);
    else beginEdit(selection.focus, value);
  }, [beginEdit, editing, readOnly, selection.focus]);

  const autoFitRow = useCallback((row = selection.focus.row) => {
    let lines = 1;
    for (const [address, value] of data) {
      try { if (parseAddress(address).row === row) lines = Math.max(lines, value.split("\n").length); } catch { /* Ignore non-cell keys. */ }
    }
    const after = Math.max(ROW_HEIGHT, Math.min(180, lines * 20 + 11));
    const next = [...rowHeights]; next[row] = after; setRowHeights(next); onRowHeightsChange?.(next);
  }, [data, onRowHeightsChange, rowHeights, selection.focus.row]);
  const changeRows = useCallback((kind: "insert" | "delete", index = range.top, count = range.bottom - range.top + 1) => {
    // Structure moves values between addresses; in a bound grid that desyncs
    // row→record identity (writes would target the wrong records).
    if (readOnly || bound) return;
    commit(changeGridStructure(data, { axis: "row", index, count, kind }), `${kind === "insert" ? "Insert" : "Delete"} row${count === 1 ? "" : "s"}`, undefined, { emitFieldWrites: false });
  }, [bound, commit, data, range.bottom, range.top, readOnly]);

  const changeColumns = useCallback((kind: "insert" | "delete", index = range.left, count = range.right - range.left + 1) => {
    if (readOnly || bound) return;
    commit(changeGridStructure(data, { axis: "column", index, count, kind }), `${kind === "insert" ? "Insert" : "Delete"} column${count === 1 ? "" : "s"}`, undefined, { emitFieldWrites: false });
  }, [bound, commit, data, range.left, range.right, readOnly]);

  const autoFitColumn = useCallback((column = selection.focus.column) => {
    let characters = datasetHeader?.fields.find((field) => field.column === column)?.label.length ?? 1;
    for (const [address, value] of data) {
      try { if (parseAddress(address).column === column) characters = Math.max(characters, value.length); } catch { /* Ignore non-cell keys. */ }
    }
    const before = columnWidths[column] ?? 140;
    const after = Math.max(72, Math.min(360, characters * 8 + 28));
    const mutation = columnWidthMutation({ column, before, after });
    if (pushHistory(mutation)) { const next = applyColumnWidthMutation(columnWidths, mutation); setColumnWidths(next); onColumnWidthsChange?.(next); }
  }, [columnWidths, data, datasetHeader, onColumnWidthsChange, pushHistory, selection.focus.column]);

  // Ctrl+D / Ctrl+R: duplicate the leading edge (top row for down, left
  // column for right — Excel semantics) across the selection through the
  // autofill tiling helper, so formulas shift relatively. Single-cell (or
  // single-row for down, single-column for right) selections are a no-op.
  const fillDown = useCallback(() => {
    if (readOnly || range.bottom === range.top) return;
    const source: GridSelection = { anchor: { row: range.top, column: range.left }, focus: { row: range.top, column: range.right } };
    const filled = fillSelection(data, source, { row: range.bottom, column: range.right }, rowCount, columnCount, canEdit);
    commit(filled.data, "Fill down", selectionAddresses(filled.selection));
    setSelection(filled.selection);
    announce("Filled down");
  }, [announce, canEdit, columnCount, commit, data, range.bottom, range.left, range.right, range.top, readOnly, rowCount]);

  const fillRight = useCallback(() => {
    if (readOnly || range.right === range.left) return;
    const source: GridSelection = { anchor: { row: range.top, column: range.left }, focus: { row: range.bottom, column: range.left } };
    const filled = fillSelection(data, source, { row: range.bottom, column: range.right }, rowCount, columnCount, canEdit);
    commit(filled.data, "Fill right", selectionAddresses(filled.selection));
    setSelection(filled.selection);
    announce("Filled right");
  }, [announce, canEdit, columnCount, commit, data, range.bottom, range.left, range.right, range.top, readOnly, rowCount]);

  const findText = useCallback((query: string) => {
    const normalized = query.toLocaleLowerCase();
    const match = [...data].find(([, value]) => value.toLocaleLowerCase().includes(normalized));
    if (!match) return undefined;
    const point = parseAddress(match[0]);
    setSelection({ anchor: point, focus: point });
    reveal(point);
    return match[0];
  }, [data, reveal]);

  const replaceAll = useCallback((query: string, replacement: string) => {
    if (readOnly || !query) return 0;
    let count = 0;
    const next = new Map(data);
    for (const [address, value] of data) {
      // Find is case-insensitive; replace must match the same cells it selects.
      const replaced = replaceAllText(value, query, replacement);
      if (replaced.count) {
        next.set(address, replaced.text);
        count += replaced.count;
      }
    }
    if (count) commit(next, "Replace all");
    return count;
  }, [commit, data, readOnly]);

  const annotate = useCallback((address: string, note: string, meta?: { author?: string; createdAt?: string }) => {
    if (readOnly) return;
    const next = setAnnotationIn(annotations, address, note, meta);
    setAnnotations(next);
    onAnnotationsChange?.(next);
  }, [annotations, onAnnotationsChange, readOnly]);
  const removeAnnotationAt = useCallback((address: string) => {
    if (readOnly) return;
    const next = removeFromAnnotations(annotations, address);
    setAnnotations(next);
    onAnnotationsChange?.(next);
  }, [annotations, onAnnotationsChange, readOnly]);

  const clearWriteState = useCallback((address: string) => {
    clearTimeout(writeStateTimers.current.get(address));
    writeStateTimers.current.delete(address);
    setWriteStates((current) => {
      if (!current.has(address)) return current;
      const next = new Map(current);
      next.delete(address);
      return next;
    });
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    undo,
    redo,
    setActiveInput: writeActiveCell,
    editActiveInput,
    commitEdit: () => finishEdit(true),
    cancelEdit: () => finishEdit(false),
    snapshot: () => ({ data, formats: formats.clone(), columnWidths: [...columnWidths], rowHeights: [...rowHeights], selection, scroll: { top: viewportRef.current?.scrollTop ?? 0, left: viewportRef.current?.scrollLeft ?? 0 }, frozenRows: frozenRowCount, frozenColumns: frozenColumnCount, annotations: [...annotations] }),
    insertRows: (index, count) => changeRows("insert", index, count),
    deleteRows: (index, count) => changeRows("delete", index, count),
    insertColumns: (index, count) => changeColumns("insert", index, count),
    deleteColumns: (index, count) => changeColumns("delete", index, count),
    autoFitColumn,
    autoFitRow,
    find: findText,
    replaceAll,
    applyFormat,
    focus: () => viewportRef.current?.focus(),
    hydrate,
    replaceData,
    clearWriteState,
    setFilter,
    clearFilter,
    setAnnotation: annotate,
    removeAnnotation: removeAnnotationAt,
    heldFieldWrites: () => [...heldWritesRef.current.values()].map((entry) => entry.write),
    commitHeldFieldWrites: () => {
      const held = [...heldWritesRef.current.values()];
      const empty = new Map<string, HeldFieldWrite>();
      heldWritesRef.current = empty;
      setHeldWrites(empty);
      onHeldFieldWritesChange?.([]);
      held.forEach(({ write, before }) => emitFieldWrite(write, before));
    },
    discardHeldFieldWrites: () => {
      const empty = new Map<string, HeldFieldWrite>();
      heldWritesRef.current = empty;
      setHeldWrites(empty);
      onHeldFieldWritesChange?.([]);
    },
  }), [annotate, annotations, clearWriteState, emitFieldWrite, onHeldFieldWritesChange, applyFormat, autoFitColumn, autoFitRow, changeColumns, changeRows, clearFilter, columnWidths, data, editActiveInput, findText, finishEdit, formats, frozenColumnCount, frozenRowCount, hydrate, replaceData, redo, removeAnnotationAt, replaceAll, rowHeights, selection, setFilter, undo, writeActiveCell]);

  useEffect(() => {
    if (editing) onEditChange?.(draft);
  }, [draft, editing, onEditChange]);

  useEffect(() => onFormatsChange?.(formats.entries()), [formats, onFormatsChange]);

  const updateFormulaReference = useCallback((next: FormulaReferenceSelection) => {
    setFormulaReference(next);
    setDraft((current) => applyFormulaReference(current, next));
    setSuggestionIndex(0);
  }, []);

  const navigateFormulaReference = useCallback((delta: GridPoint, extend: boolean) => {
    if (!editing) return;
    const next = moveFormulaReference(
      formulaReference, editing, delta, extend, rowCount, columnCount, draft.length,
    );
    updateFormulaReference(next);
    reveal(next.focus);
  }, [columnCount, draft.length, editing, formulaReference, reveal, rowCount, updateFormulaReference]);

  const selectFormulaColumn = useCallback((column: number, append = false) => {
    if (!editing || !draft.startsWith("=")) return false;
    const range = populatedColumnSelection(data, column, editing);
    if (!range) return false;
    const field = datasetHeader?.fields.find((item) => item.column === column);
    const reference = field ? `[${field.id}]` : selectionLabel(range);
    const separator = append && !/[=(,+\-*/]\s*$/.test(draft) ? "," : "";
    setDraft((current) => current + separator + reference);
    setFormulaReference({ ...range, tokenStart: draft.length + separator.length });
    setSuggestionIndex(0);
    return true;
  }, [data, datasetHeader, draft, editing]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const command = event.metaKey || event.ctrlKey;
    if (!command && event.key === "?") { event.preventDefault(); setShowShortcutHelp(true); return; }
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (command && event.key.toLowerCase() === "f" && !event.shiftKey) {
      event.preventDefault();
      setFindPanel("find");
      return;
    }
    if (command && (event.key.toLowerCase() === "h" || (event.shiftKey && event.key.toLowerCase() === "f"))) {
      event.preventDefault();
      if (!readOnly) setFindPanel("replace");
      return;
    }
    if (command && event.shiftKey && event.key.toLowerCase() === "v") {
      pasteValuesNext.current = true;
      return;
    }
    if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    if (command && !event.shiftKey && event.key.toLowerCase() === "d") { event.preventDefault(); fillDown(); return; }
    if (command && !event.shiftKey && event.key.toLowerCase() === "r") { event.preventDefault(); fillRight(); return; }
    const navigation: Record<string, GridPoint> = {
      ArrowUp: { row: -1, column: 0 }, ArrowDown: { row: 1, column: 0 },
      ArrowLeft: { row: 0, column: -1 }, ArrowRight: { row: 0, column: 1 },
    };
    if (navigation[event.key]) { event.preventDefault(); move(navigation[event.key], event.shiftKey); return; }
    if (event.key === "Tab") { event.preventDefault(); move({ row: 0, column: event.shiftKey ? -1 : 1 }, false); return; }
    if (event.key === "Enter") { event.preventDefault(); if (!readOnly) beginEdit(selection.focus); return; }
    if (event.key === "F2") { event.preventDefault(); if (!readOnly) beginEdit(selection.focus); return; }
    const openColumnMenuAt = (column: number) => {
      const header = viewportRef.current?.querySelector<HTMLDivElement>(`[role="columnheader"][data-column="${column}"]`);
      const rect = header?.getBoundingClientRect();
      setContextMenu({ axis: "column", index: column, x: rect ? rect.left + rect.width / 2 : 160, y: rect ? rect.bottom + 4 : 160 });
    };
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      openColumnMenuAt(selection.focus.column);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault(); if (!readOnly) commit(clearSelection(data, selection, canEdit), "Clear range", selectionAddresses(selection)); return;
    }
    if (!command && !event.altKey && event.key.length === 1) {
      if (readOnly) return;
      event.preventDefault(); beginEdit(selection.focus, event.key);
    }
  };

  const onCopy = (event: React.ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionToTsv(data, selection));
    const calculated = new Map<string, string>();
    for (const address of selectionAddresses(selection)) {
      const point = parseAddress(address);
      const input = data.get(address) ?? "";
      calculated.set(address, input.startsWith("=") ? displayValue(worksheet, point) : input);
    }
    event.clipboardData.setData("application/x-sheetbase-values", selectionToTsv(calculated, selection));
  };
  const onCut = (event: React.ClipboardEvent) => {
    if (readOnly) { event.preventDefault(); return; }
    onCopy(event);
    commit(clearSelection(data, selection, canEdit), "Cut range", selectionAddresses(selection));
  };
  const onPaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    if (readOnly) { pasteValuesNext.current = false; return; }
    const values = event.clipboardData.getData("application/x-sheetbase-values");
    const asValues = pasteValuesNext.current && values !== "";
    pasteValuesNext.current = false;
    const tsv = asValues ? values : event.clipboardData.getData("text/plain");
    const rows = parseTsv(tsv);
    const totalCells = rows.reduce((sum, row) => sum + row.length, 0);
    const chunkRows = Math.max(1, Math.floor(PASTE_CHUNK_CELLS / Math.max(1, rows[0]?.length ?? 1)));
    if (totalCells <= PASTE_CHUNK_CELLS) {
      const pasted = pasteTsv(data, selection.focus, tsv, rowCount, columnCount, canEdit);
      commit(pasted.data, asValues ? "Paste values" : "Paste range", selectionAddresses(pasted.selection));
      setSelection(pasted.selection);
      return;
    }
    // Large pastes apply in frame-sized slices so the viewport keeps painting.
    let working = data;
    let rowIndex = 0;
    let bottom = selection.focus.row;
    let right = selection.focus.column;
    const pasteLabel = asValues ? "Paste values" : "Paste range";
    const applyChunk = () => {
      const slice = rows.slice(rowIndex, rowIndex + chunkRows);
      const start = { row: selection.focus.row + rowIndex, column: selection.focus.column };
      const applied = applyTsvRows(working, start, slice, rowCount, columnCount, canEdit);
      working = applied.data;
      commit(applied.data, pasteLabel, selectionAddresses(applied.selection));
      rowIndex += slice.length;
      bottom = Math.max(bottom, applied.selection.focus.row);
      right = Math.max(right, applied.selection.focus.column);
      announce(`Pasting ${Math.min(rowIndex, rows.length)} of ${rows.length} rows`);
      if (rowIndex < rows.length) {
        window.setTimeout(applyChunk, 0);
        return;
      }
      setSelection({ anchor: selection.focus, focus: { row: bottom, column: right } });
    };
    applyChunk();
  };

  const resizeColumn = (column: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    let finalWidth = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      finalWidth = Math.max(72, Math.min(480, startWidth + moveEvent.clientX - startX));
      const width = finalWidth;
      setColumnWidths((current) => {
        if (current[column] === width) return current;
        const next = [...current];
        next[column] = width;
        return next;
      });
    };
    const onUp = () => {
      if (finalWidth !== startWidth) {
        pushHistory(columnWidthMutation({ column, before: startWidth, after: finalWidth }));
        const next = [...columnWidths]; next[column] = finalWidth; onColumnWidthsChange?.(next);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resizeRow = (row: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = rowHeights[row] ?? ROW_HEIGHT;
    let finalHeight = startHeight;
    const onMove = (moveEvent: PointerEvent) => {
      finalHeight = Math.max(20, Math.min(240, startHeight + moveEvent.clientY - startY));
      const height = finalHeight;
      setRowHeights((current) => {
        if (current[row] === height) return current;
        const next = [...current];
        next[row] = height;
        return next;
      });
    };
    const onUp = () => {
      if (finalHeight !== startHeight) {
        const next = [...rowHeights]; next[row] = finalHeight; onRowHeightsChange?.(next);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Stable handler surface for the memoized GridCell: `current` is reassigned
  // each render so cells always dispatch to closures over the latest state,
  // while the ref's identity never changes (which would defeat the memo).
  const cellHandlersRef = useRef<GridCellHandlers>({
    pointerDown: () => {},
    pointerEnter: () => {},
    doubleClick: () => {},
    badgeClick: () => {},
  });
  cellHandlersRef.current = {
    pointerDown: (point, event) => {
      if (event.button !== 0) return;
      const clickStart = typeof performance !== "undefined" ? performance.now() : 0;
      if (editing && draft.startsWith("=")) {
        event.preventDefault();
        dragSelecting.current = true;
        const next = {
          anchor: point,
          focus: point,
          tokenStart: formulaReference?.tokenStart ?? draft.length,
        };
        if (event.metaKey || event.ctrlKey) {
          const separator = /[=(,+\-*/]\s*$/.test(draft) ? "" : ",";
          const appended = { ...next, tokenStart: draft.length + separator.length };
          setFormulaReference(appended);
          setDraft((current) => current + separator + formulaReferenceLabel(appended));
        } else updateFormulaReference(next);
        return;
      }
      dragSelecting.current = true;
      setSelection((current) => ({ anchor: event.shiftKey ? current.anchor : point, focus: point }));
      // The pointer is already on the target: letting focus scroll would
      // yank the page mid-gesture and stale the coordinates of a
      // double-click or right-click follow-up.
      viewportRef.current?.focus({ preventScroll: true });
      if (onCellClickTiming && typeof requestAnimationFrame !== "undefined") {
        if (clickTimingFrame.current !== undefined) cancelAnimationFrame(clickTimingFrame.current);
        clickTimingFrame.current = requestAnimationFrame(() => {
          clickTimingFrame.current = requestAnimationFrame(() => onCellClickTiming(performance.now() - clickStart));
        });
      }
    },
    pointerEnter: (point) => {
      if (editing && formulaReference && dragSelecting.current) {
        updateFormulaReference({ ...formulaReference, focus: point });
        return;
      }
      if (fillOrigin.current) {
        fillTargetRef.current = point;
        setFillTarget(point);
      } else if (dragSelecting.current) setSelection((current) => ({ ...current, focus: point }));
    },
    doubleClick: (point) => { if (!readOnly) beginEdit(point); },
    badgeClick: (address, writeState, event) => {
      event.stopPropagation();
      if (event.shiftKey) {
        // A badge revert is a local-only gesture — the failed/conflicted
        // write never landed, so nothing should be re-persisted.
        commitMutation(cellChangesMutation("Revert failed write", [{ address, before: data.get(address), after: writeState.before }]), { emitFieldWrites: false });
        setWriteStates((current) => { const next = new Map(current); next.delete(address); return next; });
      } else if (writeState.status === "failed" || writeState.status === "conflict") runFieldWrite(writeState.write, writeState.before);
    },
  };

  return <div
    className={`sheetbase-scope spreadsheet${readOnly ? " spreadsheet-read-only" : ""}`}
    data-theme={theme}
    ref={viewportRef}
    tabIndex={0}
    role="grid"
    aria-readonly={readOnly || undefined}
    aria-rowcount={rowCount}
    aria-colcount={columnCount}
    onKeyDown={onKeyDown}
    onCopy={onCopy}
    onCut={onCut}
    onPaste={onPaste}
    aria-busy={loadingRanges.length > 0}
    onScroll={(event) => {
      event.currentTarget.style.setProperty("--sheet-scroll-top", `${event.currentTarget.scrollTop}px`);
      event.currentTarget.style.setProperty("--sheet-scroll-left", `${event.currentTarget.scrollLeft}px`);
    }}
  >
    <div className="grid-canvas" style={{ width: contentWidth, height: contentHeight }}>
      {visibleRows.flatMap((row) => renderColumns.map(({ index: column }) => {
        const point = { row, column };
        const key = cellKey(point);
        const active = samePoint(point, selection.focus);
        const selected = row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
        const raw = data.get(key) ?? "";
        // Dynamic-array children have no `data` entry; resolve them through the
        // worksheet spill store so SEQUENCE/UNIQUE/SORT results actually paint.
        const spilled = raw === "" ? worksheet.spills.value(key) : undefined;
        const loading = raw === "" && spilled === undefined && loadingRanges.some((loadingRange) => row >= loadingRange.rowStart && row <= loadingRange.rowEnd && column >= loadingRange.columnStart && column <= loadingRange.columnEnd);
        const writeState = writeStates.get(key);
        const annotation = annotationByAddress.get(key);
        const baseFormat = formats.get(point);
        const calculated = raw.startsWith("=") || spilled !== undefined ? displayValue(worksheet, point) : raw;
        // Empty rules are the common case — skip the per-cell scan entirely.
        const conditionalFormat = conditionalFormats.length
          ? resolveConditionalFormat(point, calculated, fieldIds[column], conditionalFormats, (conditionFieldId) => {
            const conditionColumn = columnByFieldId.get(conditionFieldId) ?? -1;
            if (conditionColumn < 0) return "";
            const conditionRaw = data.get(cellKey({ row, column: conditionColumn })) ?? "";
            return conditionRaw.startsWith("=") ? displayValue(worksheet, { row, column: conditionColumn }) : conditionRaw;
          })
          : undefined;
        const format = conditionalFormat ? { ...baseFormat, ...conditionalFormat } : baseFormat;
        const value = formatCellDisplay(calculated, format, columnDisplay[column]);
        return <GridCell
          key={key}
          address={key}
          row={row}
          column={column}
          display={value}
          isFormula={raw.startsWith("=")}
          selected={selected}
          active={active}
          loading={loading}
          className={`grid-cell${loading ? " loading-cell" : ""}${row < frozenRowCount ? " frozen-row" : ""}${row === frozenRowCount - 1 ? " freeze-row-edge" : ""}${column < frozenColumnCount ? " frozen-column" : ""}${column === frozenColumnCount - 1 ? " freeze-column-edge" : ""}${row > 0 && rowHeights[row - 1] === 0 ? " after-hidden-row" : ""}${column > 0 && columnWidths[column - 1] === 0 ? " after-hidden-column" : ""}${writeState ? ` write-${writeState.status}` : ""}${annotation ? " annotated" : ""}${!canEdit(point) ? " read-only" : ""}${selected ? " in-selection" : ""}${active ? " active-cell" : ""}`}
          title={annotation ? [annotation.author, annotation.text].filter(Boolean).join(": ") : undefined}
          format={format}
          field={fieldByColumn.get(column)}
          writeState={writeState}
          renderCell={renderCell}
          handlers={cellHandlersRef}
          left={columnLeft(column)}
          top={row < frozenRowCount ? `calc(var(--sheet-scroll-top, 0px) + ${COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[row]}px)` : COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[row]}
          width={columnWidths[column]}
          height={rowHeights[row] ?? ROW_HEIGHT}
        />;
      }))}

      {visibleRows.map((row) => <div
        role="rowheader"
        aria-selected={row >= range.top && row <= range.bottom}
        className={`row-header${row >= range.top && row <= range.bottom ? " selected-header" : ""}`}
        key={`row-${row}`}
        style={{ left: "var(--sheet-scroll-left, 0px)", top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[row], width: ROW_HEADER_WIDTH, height: rowHeights[row] ?? ROW_HEIGHT }}
        onPointerDown={() => {
          dragSelecting.current = true;
          setSelection({ anchor: { row, column: 0 }, focus: { row, column: columnCount - 1 } });
          viewportRef.current?.focus({ preventScroll: true });
        }}
        onContextMenu={(event) => { event.preventDefault(); setContextMenu({ axis: "row", index: row, x: event.clientX, y: event.clientY }); }}
      >{row + 1}<span className="row-resizer" onPointerDown={(event) => resizeRow(row, event)} onDoubleClick={(event) => { event.stopPropagation(); autoFitRow(row); }} /></div>)}

      {renderColumns.map(({ index: column }) => <div
        role="columnheader"
        aria-selected={column >= range.left && column <= range.right}
        className={`column-header${column >= range.left && column <= range.right ? " selected-header" : ""}${column > 0 && columnWidths[column - 1] === 0 ? " after-hidden-column" : ""}`}
        key={`column-${column}`}
        draggable={Boolean(onColumnMove)}
        style={{
          left: columnLeft(column),
          top: "var(--sheet-scroll-top, 0px)",
          width: columnWidths[column],
          height: COLUMN_HEADER_HEIGHT,
        }}
        onPointerDown={(event) => {
          if (editing && draft.startsWith("=")) {
            event.preventDefault();
            event.stopPropagation();
            selectFormulaColumn(column, event.metaKey || event.ctrlKey);
            return;
          }
          dragSelecting.current = true;
          setSelection({ anchor: { row: 0, column }, focus: { row: rowCount - 1, column } });
          viewportRef.current?.focus({ preventScroll: true });
        }}
        onContextMenu={(event) => { event.preventDefault(); setContextMenu({ axis: "column", index: column, x: event.clientX, y: event.clientY }); }}
        onDragStart={(event) => { event.dataTransfer.setData("application/x-sheetbase-column", String(column)); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => { if (onColumnMove) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("application/x-sheetbase-column")); if (Number.isInteger(from) && from !== column) onColumnMove?.(from, column); }}
      >
        <span className="column-coordinate">{columnLabel(column)}</span>
        <span className="column-name">{datasetHeader?.fields.find((field) => field.column === column)?.label ?? columnLabel(column)}</span>
        {fieldIds[column] && <button
          className={`column-sort${query.sort?.some((sort) => sort.fieldId === fieldIds[column]) ? " active" : ""}`}
          aria-label={`Sort ${fieldIds[column]}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const fieldId = fieldIds[column]!;
            const current = query.sort?.find((sort) => sort.fieldId === fieldId)?.direction;
            const next = current === undefined ? "asc" : current === "asc" ? "desc" : undefined;
            if (sortMode === "local" && !bound) {
              // Reordering rows moves values between addresses; the mutation
              // must not emit field writes against the wrong records. Bound
              // grids sort server-side via the query change below.
              if (next) {
                if (!sortBaselineRef.current) sortBaselineRef.current = data;
                commit(sortGridRows(sortBaselineRef.current, column, next), `Sort ${fieldId} ${next === "asc" ? "ascending" : "descending"}`, undefined, { emitFieldWrites: false });
              } else if (sortBaselineRef.current) {
                commit(sortBaselineRef.current, `Clear ${fieldId} sort`, undefined, { emitFieldWrites: false });
                sortBaselineRef.current = undefined;
              }
            }
            const otherSorts = (query.sort ?? []).filter((sort) => sort.fieldId !== fieldId);
            onQueryChange?.({ ...query, sort: next ? [...otherSorts, { fieldId, direction: next }] : otherSorts });
          }}
        >{query.sort?.find((sort) => sort.fieldId === fieldIds[column])?.direction === "asc" ? "▲" : query.sort?.find((sort) => sort.fieldId === fieldIds[column])?.direction === "desc" ? "▼" : "↕"}</button>}
        <span className="column-resizer" onPointerDown={(event) => resizeColumn(column, event)} onDoubleClick={(event) => { event.stopPropagation(); autoFitColumn(column); }} />
      </div>)}

      {findPanel && <search className="find-panel" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setFindPanel(undefined); viewportRef.current?.focus(); } }}>
        <input autoFocus aria-label="Find" placeholder="Find" value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findText(findQuery); if (event.key === "Escape") { event.preventDefault(); setFindPanel(undefined); viewportRef.current?.focus(); } }} />
        {findPanel === "replace" && <input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findText(findQuery); if (event.key === "Escape") { event.preventDefault(); setFindPanel(undefined); viewportRef.current?.focus(); } }} />}
        <button onClick={() => findText(findQuery)}>Find</button>
        {findPanel === "find" && !readOnly && <button onClick={() => setFindPanel("replace")}>Replace…</button>}
        {findPanel === "replace" && !readOnly && <button onClick={() => replaceAll(findQuery, replacement)}>Replace all</button>}
        <button aria-label="Close find" onClick={() => { setFindPanel(undefined); viewportRef.current?.focus(); }}>×</button>
      </search>}
      {contextMenu?.axis === "column" && <ColumnContextMenu x={contextMenu.x} y={contextMenu.y} column={contextMenu.index} field={datasetHeader?.fields.find((field) => field.column === contextMenu.index)} query={query} onQueryChange={onQueryChange} actions={contextMenuActions} onAutoFit={() => { autoFitColumn(contextMenu.index); closeContextMenu(); }} onMove={onColumnMove ? (direction) => { const target = contextMenu.index + direction; if (target >= 0 && target < columnCount) onColumnMove(contextMenu.index, target); closeContextMenu(); } : undefined} onHide={fieldIds[contextMenu.index] && onColumnVisibilityChange ? () => { onColumnVisibilityChange(fieldIds[contextMenu.index]!, false); closeContextMenu(); } : undefined} onFreeze={() => { const count = contextMenu.index + 1; setFrozenColumnCount(count); onFrozenColumnsChange?.(count); closeContextMenu(); }} onUnfreeze={frozenColumnCount ? () => { setFrozenColumnCount(0); onFrozenColumnsChange?.(0); closeContextMenu(); } : undefined} onFormat={onConditionalFormattingRequest ? () => { onConditionalFormattingRequest(fieldIds[contextMenu.index], contextMenu.index); closeContextMenu(); } : undefined} onClose={closeContextMenu} />}
      {contextMenu?.axis === "row" && <div className="grid-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="Row menu" tabIndex={-1} autoFocus onKeyDown={menuKeys(closeContextMenu)} onPointerDown={(event) => event.stopPropagation()}>
        {!readOnly && !bound && <button onClick={() => { contextMenu.axis === "row" ? changeRows("insert", contextMenu.index, 1) : changeColumns("insert", contextMenu.index, 1); closeContextMenu(); }}>Insert before</button>}
        {!readOnly && !bound && <button onClick={() => { contextMenu.axis === "row" ? changeRows("insert", contextMenu.index + 1, 1) : changeColumns("insert", contextMenu.index + 1, 1); closeContextMenu(); }}>Insert after</button>}
        {!readOnly && !bound && <button onClick={() => { contextMenu.axis === "row" ? changeRows("delete", contextMenu.index, 1) : changeColumns("delete", contextMenu.index, 1); closeContextMenu(); }}>Delete {contextMenu.axis}</button>}
        {contextMenu.axis === "row" && <button onClick={() => { autoFitRow(contextMenu.index); closeContextMenu(); }}>Auto-fit row</button>}
        {contextMenu.axis === "row" && <button onClick={() => { const next = [...rowHeights]; next[contextMenu.index] = 0; setRowHeights(next); onRowHeightsChange?.(next); closeContextMenu(); }}>Hide row</button>}
        {contextMenu.axis === "row" && contextMenu.index > 0 && rowHeights[contextMenu.index - 1] === 0 && <button onClick={() => { const next = [...rowHeights]; next[contextMenu.index - 1] = ROW_HEIGHT; setRowHeights(next); onRowHeightsChange?.(next); closeContextMenu(); }}>Unhide previous row</button>}
        {contextMenu.axis === "row" && <button onClick={() => { setFrozenRowCount(contextMenu.index + 1); closeContextMenu(); }}>Freeze through row</button>}
        {(frozenRowCount > 0 || frozenColumnCount > 0) && <button onClick={() => { setFrozenRowCount(0); setFrozenColumnCount(0); closeContextMenu(); }}>Unfreeze panes</button>}
        {contextMenuActions?.map((action) => <button key={action.label} onClick={() => { action.onSelect({ axis: "row", index: contextMenu.index }); closeContextMenu(); }}>{action.label}</button>)}
      </div>}


      <div className="grid-corner" style={{ left: "var(--sheet-scroll-left, 0px)", top: "var(--sheet-scroll-top, 0px)", width: ROW_HEADER_WIDTH, height: COLUMN_HEADER_HEIGHT }} />
      <div className={`selection-outline${fillTarget ? " filling" : ""}`} style={{
        left: columnLeft(previewRange.left),
        top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[previewRange.top],
        width: columnOffsets[previewRange.right + 1] - columnOffsets[previewRange.left],
        height: rowOffsets[previewRange.bottom + 1] - rowOffsets[previewRange.top],
      }}>
        {!readOnly && <button
          className="fill-handle"
          aria-label="Fill selection"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dragSelecting.current = false;
            fillOrigin.current = selection;
            fillTargetRef.current = selection.focus;
            setFillTarget(selection.focus);
          }}
        />}
      </div>

      {spillBox && <div
        className="spill-range"
        aria-hidden="true"
        style={{
          left: columnLeft(spillBox.left),
          top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[spillBox.top],
          width: columnOffsets[spillBox.right + 1] - columnOffsets[spillBox.left],
          height: rowOffsets[spillBox.bottom + 1] - rowOffsets[spillBox.top],
        }}
      />}

      {displayedReferenceRanges.map((reference, index) => {
        const referenceRange = normaliseSelection(reference);
        if (referenceRange.top >= rowCount || referenceRange.left >= columnCount) return null;
        const right = Math.min(referenceRange.right, columnCount - 1);
        const bottom = Math.min(referenceRange.bottom, rowCount - 1);
        return <div
        className={`formula-reference${suggestedRange === reference ? " suggested" : ""}`}
        key={`reference-${referenceRange.top}-${referenceRange.left}-${bottom}-${right}`}
        style={{
          left: columnLeft(referenceRange.left),
          top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[referenceRange.top],
          width: columnOffsets[right + 1] - columnOffsets[referenceRange.left],
          height: rowOffsets[bottom + 1] - rowOffsets[referenceRange.top],
          borderColor: ["#00a77b", "#f26a21", "#2f78ed", "#b44fd8"][index % 4],
        }}
      />;
      })}
      {editing && draft.startsWith("=") && <FormulaTokens value={draft} className="cell-formula-tokens" style={{
        left: columnLeft(editing.column, 1),
        top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row] + 1,
        width: columnWidths[editing.column] - 2,
        height: (rowHeights[editing.row] ?? ROW_HEIGHT) - 2,
      }} />}
      {editing && !activeCustomEditor && <input
        className={`cell-editor${draft.startsWith("=") ? " tokenised-input" : ""}`}
        autoFocus
        type={!draft.startsWith("=") && editingField?.dataType === "number" ? "number" : !draft.startsWith("=") && editingField?.dataType === "date" ? "date" : editingField?.dataType === "datetime" ? "datetime-local" : "text"}
        aria-invalid={validationError ? true : undefined}
        aria-activedescendant={suggestions.length > 0 ? `formula-suggestion-${suggestionIndex}` : undefined}
        value={draft}
        aria-label={`Edit ${cellKey(editing)}`}
        style={{
          left: columnLeft(editing.column, 1),
          top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row] + 1,
          width: columnWidths[editing.column] - 2,
          height: (rowHeights[editing.row] ?? ROW_HEIGHT) - 2,
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setFormulaReference(null);
          setValidationError(undefined);
        }}
        onBlur={(event) => {
          if ((event.relatedTarget as HTMLElement | null)?.closest("[data-formula-bar]")) return;
          finishEdit(true);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "F4" && draft.startsWith("=")) {
            event.preventDefault();
            setDraft((current) => cycleAbsoluteReference(current));
            setFormulaReference(null);
            return;
          }
          if (draft === "=" && /^[a-z]$/i.test(event.key)) {
            const column = event.key.toUpperCase().charCodeAt(0) - 65;
            if (column >= 0 && column < columnCount && selectFormulaColumn(column)) {
              event.preventDefault();
              return;
            }
          }
          const formulaNavigation: Record<string, GridPoint> = {
            ArrowUp: { row: -1, column: 0 }, ArrowDown: { row: 1, column: 0 },
            ArrowLeft: { row: 0, column: -1 }, ArrowRight: { row: 0, column: 1 },
          };
          const expectsReference = /[=(,+\-*/]\s*$/.test(draft);
          if (draft.startsWith("=") && formulaNavigation[event.key] && (formulaReference || suggestions.length === 0 || expectsReference)) {
            event.preventDefault();
            navigateFormulaReference(formulaNavigation[event.key], event.shiftKey);
            return;
          }
          if (suggestions.length && event.key === "ArrowDown") {
            event.preventDefault();
            setSuggestionIndex((current) => (current + 1) % suggestions.length);
            return;
          }
          if (suggestions.length && event.key === "ArrowUp") {
            event.preventDefault();
            setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
          }
          if (suggestions.length && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            setDraft((current) => applyFormulaSuggestion(current, suggestions[suggestionIndex]));
            setSuggestionIndex(0);
            return;
          }
          if (event.key === "Escape") { event.preventDefault(); finishEdit(false); }
          if (event.key === "Enter") { event.preventDefault(); finishEdit(true, { row: 1, column: 0 }); }
          if (event.key === "Tab") { event.preventDefault(); finishEdit(true, { row: 0, column: event.shiftKey ? -1 : 1 }); }
        }}
      />}
      {editing && activeCustomEditor && <div
        className="cell-editor custom-editor-host"
        style={{
          left: columnLeft(editing.column, 1),
          top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row] + 1,
          width: columnWidths[editing.column] - 2,
          height: (rowHeights[editing.row] ?? ROW_HEIGHT) - 2,
        }}
      >
        {activeCustomEditor.render({
          point: editing,
          address: cellKey(editing),
          field: editingField,
          initialDraft: draft,
          commit: (value) => finishEdit(true, undefined, value),
          cancel: () => finishEdit(false),
        })}
      </div>}
      {editing && !activeCustomEditor && !draft.startsWith("=") && editingField?.multiple && editingField.options && <MultiOptionPicker
        options={editingField.options}
        current={draft}
        onCommit={(value) => finishEdit(true, undefined, value)}
        onCancel={() => finishEdit(false)}
      />}
      {editing && !(editingField?.multiple && editingField.options) && !activeCustomEditor && !draft.startsWith("=") && (editingField?.dataType === "boolean" || editingField?.dataType === "relationship" || editingField?.options?.length) && <div
        className={`typed-options ${editingField.dataType ?? "text"}`}
        role={editingField.dataType === "boolean" ? "radiogroup" : "listbox"}
        aria-label={`Choose ${editingField.label}`}
        style={{ left: columnLeft(editing.column), top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row + 1] + 3, width: Math.max(columnWidths[editing.column], 180) }}
      >
        {(editingField.options ?? (editingField.dataType === "boolean" ? ["true", "false"] : [])).flatMap((option) => editingField.dataType !== "relationship" || draft === "" || option.toLocaleLowerCase().includes(draft.toLocaleLowerCase()) ? [<button
            role={editingField.dataType === "boolean" ? "radio" : "option"}
            aria-checked={editingField.dataType === "boolean" ? draft.toLocaleLowerCase() === option.toLocaleLowerCase() : undefined}
            aria-selected={editingField.dataType !== "boolean" ? draft === option : undefined}
            className={draft.toLocaleLowerCase() === option.toLocaleLowerCase() ? "active" : ""}
            key={option}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => finishEdit(true, undefined, option)}
          >{editingField.dataType === "boolean" ? (option === "true" ? "✓ Yes" : "No") : option}</button>] : [])}
      </div>}
      {editing && validationError && <div className="cell-validation" role="alert" style={{ left: columnLeft(editing.column), top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row + 1] + 3 }}>{validationError}</div>}
      {showShortcutHelp && <div className="shortcut-backdrop" role="presentation" onPointerDown={() => { setShowShortcutHelp(false); viewportRef.current?.focus(); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setShowShortcutHelp(false); viewportRef.current?.focus(); return; }
        if (event.key !== "Tab") return;
        const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
        if (focusables.length === 0) return;
        event.preventDefault();
        focusables[0]!.focus();
      }}><section className="shortcut-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} autoFocus onPointerDown={(event) => event.stopPropagation()}>
        <header><strong>Keyboard shortcuts</strong><button aria-label="Close shortcuts" onClick={() => { setShowShortcutHelp(false); viewportRef.current?.focus(); }}>×</button></header>
        <dl><dt>Find</dt><dd>Ctrl/Cmd F</dd><dt>Find and replace</dt><dd>Ctrl/Cmd Shift F</dd><dt>Undo / redo</dt><dd>Ctrl/Cmd Z · Shift Z</dd><dt>Paste values</dt><dd>Ctrl/Cmd Shift V</dd><dt>Fill down</dt><dd>Ctrl/Cmd D</dd><dt>Fill right</dt><dd>Ctrl/Cmd R</dd><dt>Edit cell</dt><dd>Enter or F2</dd><dt>Absolute reference</dt><dd>F4</dd><dt>Extend selection</dt><dd>Shift + arrows</dd><dt>Column menu</dt><dd>Menu or Shift F10</dd></dl>
      </section></div>}
      {editing && suggestions.length > 0 && <div className="formula-suggestions" role="listbox" aria-label="Formula suggestions" style={{
        left: columnLeft(editing.column),
        top: COLUMN_HEADER_HEIGHT + datasetHeaderHeight + rowOffsets[editing.row + 1] + 4,
        width: Math.max(290, columnWidths[editing.column]),
      }}>
        {suggestions.map((suggestion, index) => <button
          role="option"
          aria-selected={index === suggestionIndex}
          id={`formula-suggestion-${index}`}
          className={index === suggestionIndex ? "formula-suggestion active" : "formula-suggestion"}
          key={`${suggestion.kind}-${suggestion.label}`}
          onPointerDown={(event) => {
            event.preventDefault();
            setDraft((current) => applyFormulaSuggestion(current, suggestion));
            setSuggestionIndex(0);
          }}
        >
          <span className={`suggestion-icon ${suggestion.kind}`}>{suggestion.kind === "field" ? "ϟ" : suggestion.kind === "region" ? "▦" : "ƒ"}</span>
          <strong>{suggestion.label}</strong>
          <small>{suggestion.detail}</small>
        </button>)}
      </div>}
      <div className="grid-announcer" role="status" aria-live="polite">{announcement}</div>
    </div>
  </div>;
});
