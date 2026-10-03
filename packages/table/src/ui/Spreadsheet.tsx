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
  moveRange,
  moveSelection,
  normaliseSelection,
  applyTsvRows,
  parseTsv,
  pasteTsv,
  populatedColumnSelection,
  selectionAggregates,
  selectionLabel,
  selectionAddresses,
  selectionToTsv,
  sortGridRows,
  replaceAllText,
  edgeOfData,
  usedRangeBounds,
  validateTypedCell,
  clearRangeTargets,
  pasteTargetChanges,
  type CellDataType,
  type GridPoint,
  type GridSelection,
  type SelectionAggregates,
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
  type CellChange,
  type GridMutation,
} from "../grid/mutations";
import { CellStore } from "../grid/cell-store";
import { buildGridView, rowOffsetTable, viewCellKey, viewDisplayRow, viewSourceRow, type GridView } from "../grid/view";
import { resolveConditionalFormat, type ConditionalFormatRule } from "../grid/conditional-formatting";
import { booleanCellValue, columnDisplayDefaults, formatCellDisplay } from "./column-display";
import {
  enabledMenuActions,
  resolveBeforeCellsChange,
  resolveClipboardPayload,
  sameClauses,
  selectCustomEditor,
  type SpreadsheetBeforeCellsChange,
  type SpreadsheetClipboard,
  type SpreadsheetClipboardPayload,
  type SpreadsheetCutStatus,
  type SpreadsheetEditorMatch,
  type SpreadsheetMutationSource,
} from "./host-hooks";
import { removeAnnotation as removeFromAnnotations, setAnnotation as setAnnotationIn, type CellAnnotation } from "./annotations";
import { GridCell, type GridCellHandlers } from "./GridCell";
import {
  holdFieldWrite,
  type HeldFieldWrite,
} from "./held-field-writes";
import type { DatasetQuery, FilterClause, FilterOperator, SortClause } from "../data";
import { conflictWriteKeys, fieldWritesForMutation, type MutationFieldWrite } from "../data";
import { buildFilterValue, ensureOperator, operatorLabel, operatorsForField } from "./filter-conditions";
import { conflictValueLabel, cellStateClassName, resolveCellState, type CellState } from "./cell-state";
import { appendRowEnabled, appendRowIndex, appendRowLabel, firstWritableColumn, type AppendRowConfig } from "./append-row";
import { focusOutsideGrid, tabIntent } from "./keyboard";
import { CALC_SOURCE_LABEL, SourceBadge, showsComputedMark, type ColumnSource } from "./source-badge";
import { rebaseAutoRowHeights, useIsomorphicLayoutEffect, useThemeRowHeight } from "./row-height";

const DEFAULT_COLUMN_HEADER_HEIGHT = 31;
/** Cells per frame slice for large pastes; keeps the viewport responsive while pasting. */
const PASTE_CHUNK_CELLS = 20_000;

const DEFAULT_ROW_HEADER_WIDTH = 50;
const defaultQuery: DatasetQuery = {};

export type SpreadsheetSelection = {
  address: string;
  range: string;
  input: string;
  error?: string;
  format?: Partial<CellFormat>;
  mixedFormats?: readonly (keyof CellFormat)[];
  /** Status-bar aggregates over the selected cells; present only when the selection spans more than one cell. */
  aggregates?: SelectionAggregates;
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
  /** The live query, including the current sorts and filters. */
  getQuery(): DatasetQuery;
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
/** One column's field metadata in the dataset header. */
export type DatasetFieldHeader = Readonly<{
  id: string;
  label: string;
  column: number;
  writable?: boolean;
  computed?: boolean;
  /** Provenance for the v3 `Source` badge; omitted columns render none. */
  source?: ColumnSource;
  /** Badge label, e.g. "DS-0311 · S-15". `calc` defaults to "ƒx". */
  sourceLabel?: string;
  dataType?: CellDataType;
  required?: boolean;
  options?: readonly string[];
  multiple?: boolean;
  unit?: string;
  precision?: number;
  numberFormat?: CellFormat["numberFormat"];
  /**
   * Display-only label for a stored value (record label, category label).
   * Returning `undefined` keeps the built-in rendering. Never rewrites the
   * stored value, so bound writes keep the real value (id/key).
   */
  displayText?: (storedValue: string) => string | undefined;
}>;
export type DatasetHeaderConfig = Readonly<{
  datasetId?: string;
  recordIdForRow?(row: number): string | undefined;
  fields: readonly DatasetFieldHeader[];
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

/** Focus an element once when it mounts — the autoFocus behaviour without the attribute. */
const focusOnMount = (element: HTMLElement | null) => { element?.focus(); };

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
  return <fieldset className="typed-options multi" aria-label="Choose values">
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
    <button type="button" className="multi-apply" onClick={() => onCommit([...picked].join(", "))}>Apply</button>
    <button type="button" onClick={onCancel}>Cancel</button>
  </fieldset>;
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
  /** Default row height in px; omitted means the theme's `--row-height` (v3: 28, default: 31). */
  defaultRowHeight?: number;
  /** Column header height in px (v3: 31). */
  headerHeight?: number;
  /**
   * Optional header groups: a label row above the column headers spanning
   * the given columns (v3 source group headers). 20px tall when present.
   */
  columnGroups?: readonly { label: string; columns: readonly number[] }[];
  /** Row header width in px (v3: 50). */
  rowHeaderWidth?: number;
  readOnlyRows?: ReadonlySet<number>;
  /** Blocks value/structure mutations; selection, copy, sorting and filtering stay live. */
  readOnly?: boolean;
  /** Resolved light/dark theme owned by the grid itself. */
  theme?: "light" | "dark";
  onSelectionChange?(selection: SpreadsheetSelection): void;
  onEditChange?(value: string): void;
  /** Audit/provenance hook: fired synchronously for every committed, undone, redone, or conflict-resolved mutation. Never blocks the grid when the sink throws. */
  onMutation?(mutation: GridMutation & { at: string; revision?: string }): void;
  /**
   * Pre-commit gate for every cell mutation (edit, paste, fill, clear, move,
   * replace, structural edit, local sort). Runs *before* the change is applied.
   * Return `false` to reject the whole change set (no history entry, no bound
   * field writes, no `onMutation`); assign to `change.next` to replace
   * individual proposed values.
   */
  beforeCellsChange?: SpreadsheetBeforeCellsChange;
  onViewportChange?(viewport: SpreadsheetViewport): void;
  bindingResolver?: BindingResolver;
  fieldIds?: readonly (string | undefined)[];
  query?: DatasetQuery;
  onQueryChange?(query: DatasetQuery): void;
  /** Notified with the current sort clauses whenever they change (also inside `onQueryChange`). */
  onSortChange?(sorts: readonly SortClause[]): void;
  /** Notified with the current filter clauses whenever they change (also inside `onQueryChange`). */
  onFiltersChange?(filters: readonly FilterClause[]): void;
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
  /**
   * COMP-02.3: per-cell state. Return one of `invalid | flagged | pending |
   * derived | readonly | unsynced`, or `{ state: "conflict", count }` /
   * `{ state: "diff", before?, after }` when the cell carries data. Undefined
   * leaves the cell unstyled.
   */
  cellState?(row: number, column: number): CellState | undefined;
  /**
   * COMP-02.4: render the "New run" append row after the last populated row.
   * `true` uses the design copy; pass `{ label }` to override it. Typing into
   * the row's first writable cell runs the existing blank-row path and calls
   * `onRecordCreate`. Requires a `rowCount` large enough to hold it.
   */
  appendRow?: AppendRowConfig;
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
  /** Extra entries appended to the column header menu (the richer header-menu surface). */
  columnMenuItems?: readonly SpreadsheetMenuAction[];
  /**
   * Clipboard gates: before copy/cut/paste the host may cancel (`false`) or
   * transform the payload, and receive cut status updates.
   */
  clipboard?: SpreadsheetClipboard;
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
    items[next]?.focus();
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
  /** Stable id for host bookkeeping; the label is used when omitted. */
  id?: string;
  label: string;
  /** Hidden from the menu when true. */
  disabled?(): boolean;
  onSelect(context: { axis: "row" | "column"; index: number; fieldId?: string }): void;
}>;

export type SpreadsheetCustomEditorContext = Readonly<{
  point: GridPoint;
  address: string;
  /** Stable column id (`fieldIds[point.column]`), present for bound/local columns. */
  columnId?: string;
  field?: DatasetHeaderConfig["fields"][number];
  /** The cell's current stored value (not the display label). */
  storedValue: string;
  initialDraft: string;
  commit(value: string): void;
  cancel(): void;
}>;

export type SpreadsheetCustomEditor = Readonly<{
  matches(context: SpreadsheetEditorMatch<DatasetHeaderConfig["fields"][number]>): boolean;
  render(context: SpreadsheetCustomEditorContext): ReactNode;
}>;

/** Result of applying a grid mutation through the pre-commit gate. */
export type SpreadsheetCommitOutcome =
  | Readonly<{ status: "applied"; mutation: GridMutation }>
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "rejected" }>;

/** Options for the internal commit pipeline, shared with the pre-commit gate. */
type SpreadsheetCommitOptions = Readonly<{
  emitFieldWrites?: boolean;
  source?: SpreadsheetMutationSource;
  /** Full intended target set for a bulk operation (see `GridMutation.intended`). */
  intended?: readonly CellChange[];
}>;


function ColumnContextMenu({ x, y, column, field, query, onQueryChange, onAutoFit, onHide, onMove, onFreeze, onUnfreeze, onFormat, headerActions, actions, onClose }: Readonly<{
  x: number; y: number; column: number;
  field?: DatasetHeaderConfig["fields"][number]; query: DatasetQuery;
  onQueryChange?(query: DatasetQuery): void; onAutoFit(): void; onHide?(): void;
  onMove?(direction: -1 | 1): void; onFreeze(): void; onUnfreeze?(): void; onFormat?(): void; onClose(): void;
  headerActions?: readonly SpreadsheetMenuAction[];
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
    ref={focusOnMount}
    onKeyDown={menuKeys(onClose)}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <header><div><strong>{field?.label ?? columnLabel(column)}</strong><small>{field?.dataType ?? "column"}{sortIndex >= 0 ? ` · sort ${sortIndex + 1}` : ""}</small></div><button type="button" aria-label="Close menu" onClick={onClose}>×</button></header>
    {field && <>
      <section><div className="column-menu-label"><span className="column-menu-title">Sort</span></div><div className="column-menu-segment"><button type="button" className={sorts[sortIndex]?.direction === "asc" ? "active" : ""} onClick={() => setSort("asc")}>↑ Asc</button><button type="button" className={sorts[sortIndex]?.direction === "desc" ? "active" : ""} onClick={() => setSort("desc")}>↓ Desc</button><button type="button" onClick={() => setSort()}>Clear</button></div></section>
      <section><div className="column-menu-label"><span className="column-menu-title">Filter</span>{(query.filters?.length ?? 0) > 1 && <select aria-label="Filter logic" value={query.filterLogic ?? "and"} onChange={(event) => onQueryChange?.({ ...query, filterLogic: event.target.value as "and" | "or" })}><option value="and">Match all</option><option value="or">Match any</option></select>}</div>
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
        <div className="column-menu-actions"><button type="button" className="primary" onClick={applyFilter}>Apply</button>{existing && <button type="button" onClick={clearFilter}>Remove</button>}</div>
      </section>
    </>}
    <section className="column-menu-list"><button type="button" onClick={onAutoFit}>Auto-fit width</button>{onMove && <><button type="button" onClick={() => onMove(-1)}>Move left</button><button type="button" onClick={() => onMove(1)}>Move right</button></>}{onHide && <button type="button" onClick={onHide}>Hide column</button>}<button type="button" onClick={onFreeze}>Freeze through column</button>{onUnfreeze && <button type="button" onClick={onUnfreeze}>Unfreeze columns</button>}{onFormat && <button type="button" onClick={onFormat}>Conditional formatting…</button>}{enabledMenuActions([...(headerActions ?? []), ...(actions ?? [])]).map((action) => <button type="button" key={action.id ?? action.label} onClick={() => { action.onSelect({ axis: "column", index: column, fieldId: field?.id }); onClose(); }}>{action.label}</button>)}</section>
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
  computedColumns = new Set(),
  frozenRows: initialFrozenRows = 0,
  frozenColumns: initialFrozenColumns = 0,
  initialColumnWidths,
  initialRowHeights,
  defaultRowHeight: defaultRowHeightProp,
  headerHeight = DEFAULT_COLUMN_HEADER_HEIGHT,
  columnGroups,
  rowHeaderWidth = DEFAULT_ROW_HEADER_WIDTH,
  readOnlyRows = new Set(),
  readOnly = false,
  theme = "light",
  onSelectionChange,
  onEditChange,
  onMutation,
  beforeCellsChange,
  onViewportChange,
  bindingResolver,
  fieldIds = [],
  query = defaultQuery,
  onQueryChange,
  onSortChange,
  onFiltersChange,
  sortMode = "local",
  datasetHeader,
  onFieldWrite,
  onFieldWrites,
  fieldWritePolicy,
  onHeldFieldWritesChange,
  onRecordCreate,
  cellState,
  appendRow,
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
  columnMenuItems,
  clipboard,
}, forwardedRef) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // Row height: an explicit prop wins; otherwise the theme's `--row-height`
  // (v3 preset: 28px, default preset: 31px) so a themed host needs no JS prop.
  const themedRowHeight = useThemeRowHeight(viewportRef);
  const defaultRowHeight = defaultRowHeightProp ?? themedRowHeight;
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
  const [copyRange, setCopyRange] = useState<ReturnType<typeof normaliseSelection>>();
  /** Internal clipboard snapshot — powers Excel's Enter-to-paste flow and survives clipboard changes until dismissed. */
  const copyBuffer = useRef<{ tsv: string } | null>(null);
  /** In-flight drag-move: the grabbed range, the cell the drag started on, and the latest (clamped) drop origin. */
  const moveDrag = useRef<{ range: { top: number; left: number; bottom: number; right: number }; origin: GridPoint; target: GridPoint } | null>(null);
  const [movePreview, setMovePreview] = useState<{ top: number; left: number; bottom: number; right: number } | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>(() => initialState
    ? [...initialState.columnWidths]
    : Array.from({ length: columnCount }, (_, index) => initialColumnWidths?.[index] ?? (index < 7 ? 170 : 140)));
  const [rowHeights, setRowHeights] = useState<number[]>(() => initialState?.rowHeights
    ? [...initialState.rowHeights]
    : Array.from({ length: rowCount }, (_, row) => initialRowHeights?.[row] ?? defaultRowHeight));
  // The theme's `--row-height` is measured after mount, so rows seeded with
  // the fallback are re-baked once the real height arrives. Explicit heights
  // (`initialState`/`initialRowHeights` or a hand resize) and hidden rows (`0`)
  // are left alone.
  const autoRowHeightRef = useRef(defaultRowHeight);
  useIsomorphicLayoutEffect(() => {
    const previous = autoRowHeightRef.current;
    autoRowHeightRef.current = defaultRowHeight;
    setRowHeights((current) => rebaseAutoRowHeights(current, previous, defaultRowHeight, (row) => initialState?.rowHeights?.[row] ?? initialRowHeights?.[row]));
  }, [defaultRowHeight, initialState, initialRowHeights]);
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
  // Every sort/filter change flows through one place so the host's dedicated
  // notifications fire exactly when those surfaces change, alongside the whole
  // query callback.
  const applyQuery = useCallback((next: DatasetQuery) => {
    if (!sameClauses(query.sort, next.sort)) onSortChange?.(next.sort ?? []);
    if (!sameClauses(query.filters, next.filters)) onFiltersChange?.(next.filters ?? []);
    onQueryChange?.(next);
  }, [onFiltersChange, onQueryChange, onSortChange, query]);
  const cutStatusRef = useRef<SpreadsheetCutStatus | null>(null);
  const updateCutStatus = useCallback((next: SpreadsheetCutStatus | null) => {
    if (next === null && cutStatusRef.current === null) return;
    cutStatusRef.current = next;
    clipboard?.onCutStatusChange?.(next);
  }, [clipboard]);
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
  const shortcutHelpRef = useRef<HTMLElement | null>(null);
  // Find panel and the shortcut-help modal both close on Escape no matter
  // which of their controls holds focus — handle it at document level while
  // they are open rather than delegating on a static container.
  useEffect(() => {
    if (!findPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setFindPanel(undefined);
      viewportRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [findPanel]);
  useEffect(() => {
    if (!showShortcutHelp) return;
    const dialog = shortcutHelpRef.current;
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setShowShortcutHelp(false);
        viewportRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !dialog?.contains(document.activeElement)) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
      if (focusables.length === 0) return;
      event.preventDefault();
      focusables[0]?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) {
        setShowShortcutHelp(false);
        viewportRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showShortcutHelp]);

  const worksheet = worksheetRef.current;
  // A bound grid owns no row identity: rows are server records, so structure
  // ops and local sort must not move values between addresses. `recordIdForRow`
  // presence is the bound signal — a header passed for display metadata alone
  // leaves the grid unbound.
  const bound = datasetHeader?.recordIdForRow !== undefined;
  // Lookups hoisted out of the per-cell render loop and the local view.
  const fieldByColumn = useMemo(
    () => new Map((datasetHeader?.fields ?? []).map((field) => [field.column, field])),
    [datasetHeader],
  );
  const columnByFieldId = useMemo(
    () => new Map(fieldIds.flatMap((fieldId, column) => fieldId === undefined ? [] : [[fieldId, column] as const])),
    [fieldIds],
  );

  // ── Local view for identity-keyed bound grids ────────────────────────────
  // A bound grid keeps `data` in record order: values never move between
  // records. A local sort or filter is instead applied as a display → source
  // row mapping, so the visible order and membership change while every write,
  // annotation and field write still resolves the record behind the row the
  // user sees. Unbound grids keep their physical local sort below.
  const cellValueAt = useCallback((row: number, column: number): string => {
    const raw = data.get(cellKey({ row, column })) ?? "";
    return raw.startsWith("=") ? displayValue(worksheet, { row, column }) : raw;
  }, [data, worksheet]);
  const view = useMemo<GridView | undefined>(
    () => (bound && sortMode === "local"
      ? buildGridView({
        rowCount,
        query,
        columnFor: (fieldId) => columnByFieldId.get(fieldId),
        valueAt: cellValueAt,
        // Rows without a record are placeholders, so an active view shows the
        // records that exist rather than thousands of empty rows.
        hasRow: (row) => datasetHeader?.recordIdForRow?.(row) !== undefined,
      })
      : undefined),
    [bound, sortMode, rowCount, query, columnByFieldId, cellValueAt, datasetHeader],
  );
  /** Number of rows the grid displays (fewer than `rowCount` when filtered). */
  const viewRowCount = view ? view.rows.length : rowCount;
  /** Source row a displayed row shows; -1 when the view hides it. */
  const sourceRowOf = useCallback((row: number) => viewSourceRow(view, row), [view]);
  /** Display row a source row appears at; -1 when the view hides it. */
  const displayRowOf = useCallback((row: number) => viewDisplayRow(view, row), [view]);
  /** Resolves a displayed coordinate to the stored address it shows ("" when hidden). */
  const keyFor = useCallback((point: GridPoint): string => viewCellKey(view, point), [view]);
  const cellKeyAt = useCallback((row: number, column: number) => keyFor({ row, column }), [keyFor]);
  const rowHeightAt = useCallback(
    (row: number) => rowHeights[sourceRowOf(row)] ?? defaultRowHeight,
    [defaultRowHeight, rowHeights, sourceRowOf],
  );

  // A local view re-orders and hides rows, so a selection held in display rows
  // would otherwise point at a different record after the order settles. Remap
  // it by record (source row) so the selected records survive a sort or filter;
  // a record the filter now hides keeps its display position.
  const previousViewRef = useRef<GridView | undefined | null>(null);
  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (previous === null || previous === view) return;
    const lastRow = Math.max(0, viewRowCount - 1);
    const remap = (row: number) => {
      const source = previous ? previous.rows[row] ?? -1 : row;
      if (source < 0) return row;
      return view ? view.indexOf.get(source) ?? row : source;
    };
    setSelection((current) => {
      const anchor = { row: Math.min(remap(current.anchor.row), lastRow), column: current.anchor.column };
      const focus = { row: Math.min(remap(current.focus.row), lastRow), column: current.focus.column };
      return anchor.row === current.anchor.row && focus.row === current.focus.row
        ? current
        : { anchor, focus };
    });
  }, [view, viewRowCount]);

  const rowVirtualizer = useVirtualizer({
    count: viewRowCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: (row) => rowHeightAt(row),
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
          distance: editing ? Math.abs(column - editing.column) + Math.abs(start - sourceRowOf(editing.row)) / 100 : column,
        });
      };
      for (const row of rows.slice(1)) {
        if (row !== previous + 1) { add(previous); start = row; }
        previous = row;
      }
      add(previous);
    }
    return regions.sort((a, b) => a.distance - b.distance).slice(0, 12);
  }, [data, datasetHeader, editing, formulaFields, sourceRowOf]);
  const structuredRanges = useMemo(() => new Map<string, string>(formulaRegions.flatMap((region) => {
    const fieldId = /^\[([^\]]+)\]$/.exec(region.reference ?? "")?.[1];
    return fieldId ? [[fieldId, region.label]] : [];
  })), [formulaRegions]);
  useEffect(() => { structuredRangesRef.current = structuredRanges; }, [structuredRanges]);
  const structuredRangeSignature = [...structuredRanges].map(([field, region]) => `${field}:${region}`).join("|");
  const suggestions = useMemo(
    // Field suggestions name the stored cell (`B4`), so they read the source row.
    () => editing ? formulaSuggestions(draft, sourceRowOf(editing.row), formulaFields, formulaRegions) : [],
    [draft, editing, formulaFields, formulaRegions, sourceRowOf],
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: structuredRangeSignature is the content signature of the structuredRanges map, which keeps a stable identity
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
  const editingColumnId = editing ? fieldIds[editing.column] : undefined;
  const activeCustomEditor = editing
    ? selectCustomEditor(customEditors, { point: editing, columnId: editingColumnId, field: editingField })
    : undefined;
  const columnOffsets = useMemo(() => {
    const offsets = [0];
    for (const width of columnWidths) offsets.push(offsets[offsets.length - 1] + width);
    return offsets;
  }, [columnWidths]);
  const rowOffsets = useMemo(
    () => rowOffsetTable(viewRowCount, (index) => rowHeightAt(index)),
    [rowHeightAt, viewRowCount],
  );
  // Frozen columns ride the imperative --sheet-scroll-left custom property
  // (set in onScroll), the same way frozen rows ride --sheet-scroll-top — so
  // scroll never needs a React state update just to reposition them.
  const columnLeft = (column: number, extra = 0): number | string => {
    const base = rowHeaderWidth + columnOffsets[column] + extra;
    return column < frozenColumnCount ? `calc(var(--sheet-scroll-left, 0px) + ${base}px)` : base;
  };
  // COMP-02.4: the append row sits one past the last populated row. When it is
  // inside the virtual window it renders like any row (with the "+"/"new"
  // header); at the very end it is painted as an overlay past the last virtual
  // row instead. Under a local view it always sits at the end of the displayed
  // rows, since the source row that follows the data may be filtered away.
  const appendIndex = useMemo(() => (readOnly ? undefined : appendRowIndex(data, appendRow)), [appendRow, data, readOnly]);
  const appendEnabled = appendIndex !== undefined && appendRowEnabled(appendRow);
  const appendDisplayIndex = appendEnabled && appendIndex !== undefined ? (view ? viewRowCount : appendIndex) : undefined;
  /** Source row the append row creates into: the row after the last populated one. */
  const appendSourceRow = appendIndex ?? 0;
  const appendInRows = appendDisplayIndex !== undefined && appendDisplayIndex < viewRowCount;
  const appendBeyond = appendDisplayIndex !== undefined && (view !== undefined || appendIndex === rowCount);
  const draftRow = appendEnabled && editing?.row === appendDisplayIndex;
  const datasetHeaderHeight = columnGroups && columnGroups.length > 0 ? 20 : 0;
  const contentWidth = rowHeaderWidth + columnVirtualizer.getTotalSize();
  const contentHeight = headerHeight + datasetHeaderHeight + rowVirtualizer.getTotalSize() + (appendBeyond ? (rowHeights[rowCount] ?? defaultRowHeight) : 0);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const viewportRange = {
    rowStart: virtualRows[0]?.index ?? 0,
    rowEnd: virtualRows.at(-1)?.index ?? 0,
    columnStart: virtualColumns[0]?.index ?? 0,
    columnEnd: virtualColumns.at(-1)?.index ?? 0,
  };
  const visibleRows = [...new Set([
    ...Array.from({ length: Math.min(frozenRowCount, viewRowCount) }, (_, row) => row),
    ...virtualRows.map((item) => item.index),
  ])];
  const renderRows = appendInRows && appendDisplayIndex !== undefined && !visibleRows.includes(appendDisplayIndex)
    ? [...visibleRows, appendDisplayIndex].sort((a, b) => a - b)
    : visibleRows;
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
  const activeKey = cellKeyAt(selection.focus.row, selection.focus.column);
  const spillOwner = activeKey === "" ? undefined : worksheet.spills.owner(activeKey);
  const spillBox = (() => {
    if (!spillOwner) return undefined;
    const addresses = worksheet.spills.range(spillOwner);
    if (addresses.length < 2) return undefined;
    let top = viewRowCount, left = columnCount, bottom = -1, right = -1;
    for (const address of addresses) {
      try {
        const point = parseAddress(address);
        if (point.column < 0 || point.column >= columnCount) continue;
        // Spill addresses are stored rows; paint them where their records show.
        const displayRow = displayRowOf(point.row);
        if (displayRow < 0) continue;
        top = Math.min(top, displayRow); left = Math.min(left, point.column);
        bottom = Math.max(bottom, displayRow); right = Math.max(right, point.column);
      } catch { /* Ignore non-cell keys. */ }
    }
    return bottom >= top && right >= left ? { top, left, bottom, right } : undefined;
  })();

  // Excel-style copy marquee: the copied range keeps an animated dashed
  // outline that survives selection moves and pastes (repeat-paste), and is
  // dismissed by Escape, a fresh edit, or clearing cells. Clamp to the grid
  // in case rows or columns were removed after the copy.
  const copyBox = copyRange && copyRange.top < viewRowCount && copyRange.left < columnCount
    ? { top: copyRange.top, left: copyRange.left, bottom: Math.min(copyRange.bottom, viewRowCount - 1), right: Math.min(copyRange.right, columnCount - 1) }
    : undefined;
  const selectionIsCopySource = copyBox !== undefined && !fillTarget
    && copyBox.top === range.top && copyBox.bottom === range.bottom
    && copyBox.left === range.left && copyBox.right === range.right;

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
      Promise.resolve(onFieldWrite?.(entry.write)).then(
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
   * The pre-commit gate runs first: a rejected mutation applies nothing.
   */
  const commitMutation = useCallback((mutation: GridMutation, options?: SpreadsheetCommitOptions): SpreadsheetCommitOutcome => {
    const resolved = resolveBeforeCellsChange(beforeCellsChange, mutation, options?.source ?? "edit", datasetHeader);
    if (!resolved) return { status: "rejected" };
    if (!pushHistory(resolved)) return { status: "empty" };
    const writes = options?.emitFieldWrites === false ? [] : fieldWritesForMutation(resolved, datasetHeader);
    applyWorksheetMutation(worksheet, resolved);
    setData((current) => applyCellMutation(current, resolved));
    emitFieldWrites(writes);
    return { status: "applied", mutation: resolved };
  }, [beforeCellsChange, datasetHeader, emitFieldWrites, pushHistory, worksheet]);

  const commit = useCallback((next: ReadonlyMap<string, string>, label = "Edit cells", affectedAddresses?: Iterable<string>, options?: SpreadsheetCommitOptions) => {
    const mutation = cellMutation(label, data, next, affectedAddresses);
    return commitMutation(options?.intended?.length ? { ...mutation, intended: options.intended } : mutation, options);
  }, [commitMutation, data]);


  // Declarative per-column display defaults (units, precision, number format)
  // from the host's dataset header — display only, never stored values.
  const columnDisplay = useMemo(
    () => columnDisplayDefaults(datasetHeader?.fields ?? []),
    [datasetHeader],
  );

  // Two namespaces: record-keyed annotations match bound cells by
  // (recordId, fieldId) wherever the record renders; address-keyed entries
  // (unbound sheets, free columns, legacy state) match by coordinate. A bound
  // cell never adopts a record-keyed note through its stale stored address.
  const annotationMaps = useMemo(() => {
    const byRecord = new Map<string, CellAnnotation>();
    const byAddressKeyed = new Map<string, CellAnnotation>();
    const byAddressAll = new Map<string, CellAnnotation>();
    for (const annotation of annotations) {
      if (annotation.recordId !== undefined && annotation.fieldId !== undefined) {
        byRecord.set(`${annotation.recordId}\u0000${annotation.fieldId}`, annotation);
      } else {
        byAddressKeyed.set(annotation.address, annotation);
      }
      byAddressAll.set(annotation.address, annotation);
    }
    return { byRecord, byAddressKeyed, byAddressAll };
  }, [annotations]);

  const canEdit = useCallback((point: GridPoint) => {
    if (readOnly) return false;
    // `readOnlyRows` is host data, indexed by the row's record (source row).
    if (readOnlyRows.has(sourceRowOf(point.row))) return false;
    const field = fieldByColumn.get(point.column);
    return field?.writable !== false;
  }, [fieldByColumn, readOnly, readOnlyRows, sourceRowOf]);

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
    const key = cellKeyAt(selection.focus.row, selection.focus.column);
    if (key === "") return;
    commitMutation(cellChangesMutation("Edit cell", [{
      address: key,
      before: data.get(key),
      after: value === "" ? undefined : value,
    }]), { source: "edit" });
  }, [canEdit, cellKeyAt, commitMutation, data, readOnly, selection.focus]);

  const applyFormat = useCallback((patch: Partial<CellFormat>) => {
    if (readOnly) return;
    const next = formats.clone();
    const activeRow = sourceRowOf(selection.focus.row);
    const current = (activeRow < 0 ? undefined : next.get({ row: activeRow, column: selection.focus.column })) ?? {};
    // Formats are stored against the row that owns the value, so a locally
    // sorted view keeps a format with its record. A display rectangle is not a
    // contiguous source range under a view, so each cell is written on its own.
    if (view) {
      const points = new Map<string, GridPoint>();
      for (let row = range.top; row <= range.bottom; row++) {
        const source = sourceRowOf(row);
        if (source < 0) continue;
        for (let column = range.left; column <= range.right; column++) {
          const point = { row: source, column };
          points.set(cellKey(point), point);
        }
      }
      for (const point of points.values()) next.write({ start: point, end: point }, { ...current, ...patch });
    } else {
      next.write({
        start: { row: range.top, column: range.left },
        end: { row: range.bottom, column: range.right },
      }, { ...current, ...patch });
    }
    const mutation = formatMutation("Format range", formats, next);
    if (pushHistory(mutation)) setFormats(next);
  }, [formats, pushHistory, range.bottom, range.left, range.right, range.top, readOnly, selection.focus, sourceRowOf, view]);

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
    applyQuery({ ...query, filters: [...(query.filters ?? []).filter((item) => item.fieldId !== filter.fieldId), filter] });
  }, [applyQuery, query]);

  const clearFilter = useCallback((fieldId: string) => {
    applyQuery({ ...query, filters: (query.filters ?? []).filter((item) => item.fieldId !== fieldId) });
  }, [applyQuery, query]);

  useEffect(() => {
    if (bindingResolver) worksheet.setBindingResolver(bindingResolver);
  }, [bindingResolver, worksheet]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: structuredRangeSignature is the content signature of the structuredRanges map; it is the renormalisation trigger, not a capture
  useEffect(() => {
    worksheet.renormalizeFormulas();
  }, [structuredRangeSignature, worksheet]);

  useEffect(() => {
    const address = cellKeyAt(selection.focus.row, selection.focus.column);
    const input = address === "" ? "" : data.get(address) ?? "";
    const sourceFocus = { row: sourceRowOf(selection.focus.row), column: selection.focus.column };
    const value = input.startsWith("=") ? displayValue(worksheet, sourceFocus) : input;
    const properties: readonly (keyof CellFormat)[] = ["foreground", "background", "fontWeight", "horizontalAlign", "numberFormat"];
    // Formats are stored against the rows that own the values, so the painted
    // range is the source span of the selected records, not the display box.
    let sourceTop = Infinity;
    let sourceBottom = -1;
    for (let row = range.top; row <= range.bottom; row++) {
      const source = sourceRowOf(row);
      if (source < 0) continue;
      sourceTop = Math.min(sourceTop, source);
      sourceBottom = Math.max(sourceBottom, source);
    }
    const overlaps = sourceBottom >= sourceTop
      ? formats.query({ start: { row: sourceTop, column: range.left }, end: { row: sourceBottom, column: range.right } })
      : [];
    const area = sourceBottom >= sourceTop ? (sourceBottom - sourceTop + 1) * (range.right - range.left + 1) : 0;
    const covered = overlaps.reduce((sum, entry) => {
      const top = Math.max(sourceTop, Math.min(entry.range.start.row, entry.range.end.row));
      const bottom = Math.min(sourceBottom, Math.max(entry.range.start.row, entry.range.end.row));
      const left = Math.max(range.left, Math.min(entry.range.start.column, entry.range.end.column));
      const right = Math.min(range.right, Math.max(entry.range.start.column, entry.range.end.column));
      return sum + Math.max(0, bottom - top + 1) * Math.max(0, right - left + 1);
    }, 0);
    const mixedFormats = properties.filter((property) => {
      const values = new Set<string | undefined>(overlaps.map((entry) => JSON.stringify(entry.value[property])));
      if (covered < area) values.add(undefined);
      return values.size > 1;
    });
    const aggregates = area > 1
      ? selectionAggregates(data, selection, (point) => displayValue(worksheet, { row: sourceRowOf(point.row), column: point.column }), keyFor)
      : undefined;
    onSelectionChange?.({ address, range: selectionLabel(selection), input, error: formulaErrorMessage(value), format: formats.get(sourceFocus) ?? {}, mixedFormats, aggregates });
  }, [cellKeyAt, data, formats, keyFor, onSelectionChange, range.bottom, range.left, range.right, range.top, selection, sourceRowOf, worksheet]);

  useEffect(() => {
    const finishDrag = () => {
      dragSelecting.current = false;
      if (moveDrag.current) {
        const drag = moveDrag.current;
        moveDrag.current = null;
        setMovePreview(null);
        if (drag.target.row === drag.range.top && drag.target.column === drag.range.left) {
          // Pointer released without the range leaving its origin: treat the
          // press as a click and collapse the selection to the grabbed cell.
          setSelection({ anchor: drag.origin, focus: drag.origin });
        } else {
          const source: GridSelection = { anchor: { row: drag.range.top, column: drag.range.left }, focus: { row: drag.range.bottom, column: drag.range.right } };
          const moved = moveRange(data, source, drag.target, viewRowCount, columnCount, canEdit, keyFor);
          if (moved) {
            // The mutation diff only covers listed addresses — the source
            // cells must be included or their cleared values never apply.
            commit(moved.data, "Move range", [...selectionAddresses(source, keyFor), ...selectionAddresses(moved.selection, keyFor)], { source: "move", intended: moved.intended });
            setSelection(moved.selection);
            setCopyRange(undefined);
            copyBuffer.current = null;
          }
        }
      }
      if (!readOnly && fillOrigin.current && fillTargetRef.current) {
        const filled = fillSelection(data, fillOrigin.current, fillTargetRef.current, viewRowCount, columnCount, canEdit, keyFor);
        const outcome = commit(filled.data, "Autofill", selectionAddresses(filled.selection, keyFor), { source: "fill", intended: filled.intended });
        if (outcome.status !== "rejected") setSelection(filled.selection);
      }
      fillOrigin.current = null;
      fillTargetRef.current = null;
      setFillTarget(null);
    };
    window.addEventListener("pointerup", finishDrag);
    return () => window.removeEventListener("pointerup", finishDrag);
  }, [canEdit, columnCount, commit, data, keyFor, readOnly, viewRowCount]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: columnWidths is a deliberate re-measure trigger, not a capture
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidths]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rowHeights is a deliberate re-measure trigger, not a capture
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeights, rowVirtualizer]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", close, { once: true });
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial scroll restore is mount-only by design
  useEffect(() => {
    if (!initialState || !viewportRef.current) return;
    viewportRef.current.scrollTop = initialState.scroll.top;
    viewportRef.current.scrollLeft = initialState.scroll.left;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewportRange is rebuilt every render; its numeric fields are the meaningful fields
  useEffect(() => {
    if (!view) {
      onViewportChange?.(viewportRange);
      return;
    }
    // A local view reports the source rows behind the visible window, so a
    // viewport loader keeps loading the records the user is looking at.
    const start = sourceRowOf(viewportRange.rowStart);
    const end = sourceRowOf(viewportRange.rowEnd);
    onViewportChange?.({
      rowStart: Math.max(0, Math.min(start, end)),
      rowEnd: Math.max(start, end),
      columnStart: viewportRange.columnStart,
      columnEnd: viewportRange.columnEnd,
    });
  }, [
    onViewportChange,
    sourceRowOf,
    view,
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
      const activeAddress = cellKeyAt(current.focus.row, current.focus.column);
      const owner = activeAddress === "" ? undefined : worksheet.spills.owner(activeAddress);
      const addresses = owner ? worksheet.spills.range(owner) : [];
      if (addresses.length > 1) {
        let top = viewRowCount, left = columnCount, bottom = -1, right = -1;
        for (const address of addresses) {
          try {
            const point = parseAddress(address);
            if (point.column < 0 || point.column >= columnCount) continue;
            const displayRow = displayRowOf(point.row);
            if (displayRow < 0) continue;
            top = Math.min(top, displayRow); left = Math.min(left, point.column);
            bottom = Math.max(bottom, displayRow); right = Math.max(right, point.column);
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
    const next = moveSelection(current, delta, viewRowCount, columnCount, extend);
    setSelection(next);
    queueMicrotask(() => reveal(next.focus));
  }, [cellKeyAt, columnCount, displayRowOf, reveal, viewRowCount, worksheet]);

  const hasCellValue = useCallback(
    (address: string) => (data.get(address) ?? "") !== "" || worksheet.spills.value(address) !== undefined,
    [data, worksheet],
  );

  // Ctrl+Arrow: jump to the edge of the contiguous populated/empty run in
  // that direction, Excel-style. Shift extends the selection.
  const jumpToEdge = useCallback((delta: GridPoint, extend: boolean) => {
    const current = selectionRef.current;
    const focus = edgeOfData(hasCellValue, current.focus, delta, viewRowCount, columnCount, keyFor);
    if (samePoint(focus, current.focus)) return;
    setSelection(extend ? { anchor: current.anchor, focus } : { anchor: focus, focus });
    queueMicrotask(() => reveal(focus));
  }, [columnCount, hasCellValue, keyFor, reveal, viewRowCount]);

  const selectWhole = useCallback(() => {
    setSelection({ anchor: { row: 0, column: 0 }, focus: { row: viewRowCount - 1, column: columnCount - 1 } });
  }, [columnCount, viewRowCount]);

  const beginEdit = useCallback((point: GridPoint, replaceWith?: string) => {
    if (!canEdit(point)) return;
    setSelection({ anchor: point, focus: point });
    setCopyRange(undefined);
    updateCutStatus(null);
    setEditing(point);
    setDraft(replaceWith ?? data.get(cellKeyAt(point.row, point.column)) ?? "");
    setSuggestionIndex(0);
    setFormulaReference(null);
    setValidationError(undefined);
  }, [canEdit, cellKeyAt, data, updateCutStatus]);

  /** COMP-02.4: click on the append row targets its first writable cell. */
  const selectAppendRow = useCallback(() => {
    if (appendDisplayIndex === undefined || readOnly) return;
    const column = firstWritableColumn(datasetHeader?.fields ?? []);
    setSelection({ anchor: { row: appendDisplayIndex, column }, focus: { row: appendDisplayIndex, column } });
    queueMicrotask(() => viewportRef.current?.focus({ preventScroll: true }));
  }, [appendDisplayIndex, datasetHeader, readOnly]);

  const finishEdit = useCallback((save: boolean, movement?: GridPoint, explicitDraft?: string) => {
    if (!editing) return;
    if (save && readOnly) { setEditing(null); setFormulaReference(null); queueMicrotask(() => viewportRef.current?.focus()); return; }
    if (save) {
      const key = cellKeyAt(editing.row, editing.column);
      if (key === "") { setEditing(null); setFormulaReference(null); return; }
      // The append row is a display-only position at the end of the view; its
      // record is the source row that follows the populated data.
      const editingSourceRow = appendEnabled && appendDisplayIndex !== undefined && editing.row === appendDisplayIndex
        ? appendSourceRow
        : sourceRowOf(editing.row);
      const completedDraft = completeFormula(explicitDraft ?? draft);
      const field = datasetHeader?.fields.find((item) => item.column === editing.column);
      const invalid = field ? validateTypedCell(completedDraft, field.dataType, field.required, field.options) : undefined;
      if (invalid) { setValidationError(invalid); return; }
      const rowWasBlank = datasetHeader ? datasetHeader.fields.every((item) => !(data.get(cellKey({ row: editingSourceRow, column: item.column })) ?? "").trim()) : false;
      const before = data.get(key);
      // The single-edit write goes through runFieldWrite below, which carries
      // the blank-row record-create semantics — commitMutation must not also
      // dispatch a bulk write for this mutation.
      const outcome = commitMutation(cellChangesMutation("Edit cell", [{
        address: key,
        before,
        after: completedDraft === "" ? undefined : completedDraft,
      }]), { emitFieldWrites: false, source: "edit" });
      // A rejected edit applies nothing and leaves the editor open so the host
      // can show its own feedback; replaced values are the ones that persisted.
      if (outcome.status === "rejected") return;
      const appliedCell = outcome.status === "applied" ? outcome.mutation.cells.find((cell) => cell.address === key) : undefined;
      const appliedValue = appliedCell ? appliedCell.after ?? "" : completedDraft;
      const recordId = datasetHeader?.recordIdForRow?.(editingSourceRow);
      // Skip the write entirely when the edit changed nothing — an unchanged
      // commit still bumps the server revision and pollutes held writes.
      if (field && (!rowWasBlank || recordId) && (before ?? "") !== appliedValue) runFieldWrite({ address: key, row: editingSourceRow, datasetId: datasetHeader?.datasetId, recordId, fieldId: field.id, value: appliedValue }, before);
      if (rowWasBlank && datasetHeader && appliedValue !== "") {
        const values = Object.fromEntries(datasetHeader.fields.map((item) => [item.id, item.column === editing.column ? appliedValue : data.get(cellKey({ row: editingSourceRow, column: item.column })) ?? ""]));
        if (onRecordCreate) Promise.resolve(onRecordCreate({ row: editingSourceRow, values })).catch(() => undefined);
      }
    }
    setEditing(null);
    setFormulaReference(null);
    if (movement) move(movement, false);
    queueMicrotask(() => viewportRef.current?.focus());
  }, [appendDisplayIndex, appendEnabled, appendSourceRow, cellKeyAt, commitMutation, data, datasetHeader, draft, editing, move, onRecordCreate, readOnly, runFieldWrite, sourceRowOf]);

  const editActiveInput = useCallback((value: string) => {
    if (readOnly) return;
    if (editing) setDraft(value);
    else beginEdit(selection.focus, value);
  }, [beginEdit, editing, readOnly, selection.focus]);

  const autoFitRow = useCallback((row = selection.focus.row) => {
    const source = sourceRowOf(row);
    if (source < 0) return;
    let lines = 1;
    for (const [address, value] of data) {
      try { if (parseAddress(address).row === source) lines = Math.max(lines, value.split("\n").length); } catch { /* Ignore non-cell keys. */ }
    }
    const after = Math.max(defaultRowHeight, Math.min(180, lines * 20 + 11));
    const next = [...rowHeights]; next[source] = after; setRowHeights(next); onRowHeightsChange?.(next);
  }, [data, defaultRowHeight, onRowHeightsChange, rowHeights, selection.focus.row, sourceRowOf]);
  const changeRows = useCallback((kind: "insert" | "delete", index = range.top, count = range.bottom - range.top + 1) => {
    // Structure moves values between addresses; in a bound grid that desyncs
    // row→record identity (writes would target the wrong records).
    if (readOnly || bound) return;
    commit(changeGridStructure(data, { axis: "row", index, count, kind }), `${kind === "insert" ? "Insert" : "Delete"} row${count === 1 ? "" : "s"}`, undefined, { emitFieldWrites: false, source: "structure" });
  }, [bound, commit, data, range.bottom, range.top, readOnly]);

  const changeColumns = useCallback((kind: "insert" | "delete", index = range.left, count = range.right - range.left + 1) => {
    if (readOnly || bound) return;
    commit(changeGridStructure(data, { axis: "column", index, count, kind }), `${kind === "insert" ? "Insert" : "Delete"} column${count === 1 ? "" : "s"}`, undefined, { emitFieldWrites: false, source: "structure" });
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
    const filled = fillSelection(data, source, { row: range.bottom, column: range.right }, viewRowCount, columnCount, canEdit, keyFor);
    const outcome = commit(filled.data, "Fill down", selectionAddresses(filled.selection, keyFor), { source: "fill", intended: filled.intended });
    if (outcome.status !== "rejected") setSelection(filled.selection);
    announce("Filled down");
  }, [announce, canEdit, columnCount, commit, data, keyFor, range.bottom, range.left, range.right, range.top, readOnly, viewRowCount]);

  const fillRight = useCallback(() => {
    if (readOnly || range.right === range.left) return;
    const source: GridSelection = { anchor: { row: range.top, column: range.left }, focus: { row: range.bottom, column: range.left } };
    const filled = fillSelection(data, source, { row: range.bottom, column: range.right }, viewRowCount, columnCount, canEdit, keyFor);
    const outcome = commit(filled.data, "Fill right", selectionAddresses(filled.selection, keyFor), { source: "fill", intended: filled.intended });
    if (outcome.status !== "rejected") setSelection(filled.selection);
    announce("Filled right");
  }, [announce, canEdit, columnCount, commit, data, keyFor, range.bottom, range.left, range.right, range.top, readOnly, viewRowCount]);

  const findText = useCallback((query: string) => {
    const normalized = query.toLocaleLowerCase();
    const match = [...data].find(([address, value]) => {
      if (!value.toLocaleLowerCase().includes(normalized)) return false;
      // A locally filtered row is not on screen; searching must not select it.
      try { return displayRowOf(parseAddress(address).row) >= 0; } catch { return false; }
    });
    if (!match) return undefined;
    const sourcePoint = parseAddress(match[0]);
    const point = { row: displayRowOf(sourcePoint.row), column: sourcePoint.column };
    setSelection({ anchor: point, focus: point });
    reveal(point);
    return match[0];
  }, [data, displayRowOf, reveal]);

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
    if (count) commit(next, "Replace all", undefined, { source: "replace" });
    return count;
  }, [commit, data, readOnly]);

  /** Resolve a cell address to its bound identity when the grid is bound —
   *  (recordId, fieldId) both required; free columns stay address-keyed. */
  const annotationCellRef = useCallback((address: string): { address: string; recordId?: string; fieldId?: string; bound?: boolean } => {
    if (!bound) return { address };
    try {
      const point = parseAddress(address);
      const recordId = datasetHeader?.recordIdForRow?.(point.row);
      const fieldId = fieldIds[point.column];
      return recordId !== undefined && fieldId !== undefined
        ? { address, recordId, fieldId, bound: true }
        : { address, bound: true };
    } catch {
      return { address, bound: true };
    }
  }, [bound, datasetHeader, fieldIds]);

  const annotate = useCallback((address: string, note: string, meta?: { author?: string; createdAt?: string }) => {
    if (readOnly) return;
    const cell = annotationCellRef(address);
    const next = setAnnotationIn(annotations, cell.address, note, { ...meta, recordId: cell.recordId, fieldId: cell.fieldId, bound: cell.bound });
    setAnnotations(next);
    onAnnotationsChange?.(next);
  }, [annotations, onAnnotationsChange, readOnly, annotationCellRef]);
  const removeAnnotationAt = useCallback((address: string) => {
    if (readOnly) return;
    const next = removeFromAnnotations(annotations, annotationCellRef(address));
    setAnnotations(next);
    onAnnotationsChange?.(next);
  }, [annotations, onAnnotationsChange, readOnly, annotationCellRef]);

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
    getQuery: () => query,
    setAnnotation: annotate,
    removeAnnotation: removeAnnotationAt,
    heldFieldWrites: () => [...heldWritesRef.current.values()].map((entry) => entry.write),
    commitHeldFieldWrites: () => {
      const held = [...heldWritesRef.current.values()];
      const empty = new Map<string, HeldFieldWrite>();
      heldWritesRef.current = empty;
      setHeldWrites(empty);
      onHeldFieldWritesChange?.([]);
      held.forEach(({ write, before }) => { emitFieldWrite(write, before); });
    },
    discardHeldFieldWrites: () => {
      const empty = new Map<string, HeldFieldWrite>();
      heldWritesRef.current = empty;
      setHeldWrites(empty);
      onHeldFieldWritesChange?.([]);
    },
  }), [annotate, annotations, clearWriteState, emitFieldWrite, onHeldFieldWritesChange, applyFormat, autoFitColumn, autoFitRow, changeColumns, changeRows, clearFilter, columnWidths, data, editActiveInput, findText, finishEdit, formats, frozenColumnCount, frozenRowCount, hydrate, query, replaceData, redo, removeAnnotationAt, replaceAll, rowHeights, selection, setFilter, undo, writeActiveCell]);

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
    // Formula references are stored coordinates (the formula text names data
    // cells), so the walk happens in source space and only the scroll follows
    // the displayed row.
    const origin = { row: sourceRowOf(editing.row), column: editing.column };
    if (origin.row < 0) return;
    const next = moveFormulaReference(
      formulaReference, origin, delta, extend, rowCount, columnCount, draft.length,
    );
    updateFormulaReference(next);
    const display = displayRowOf(next.focus.row);
    if (display >= 0) reveal({ row: display, column: next.focus.column });
  }, [columnCount, displayRowOf, draft.length, editing, formulaReference, reveal, rowCount, sourceRowOf, updateFormulaReference]);

  const selectFormulaColumn = useCallback((column: number, append = false) => {
    if (!editing || !draft.startsWith("=")) return false;
    const origin = { row: sourceRowOf(editing.row), column: editing.column };
    if (origin.row < 0) return false;
    const range = populatedColumnSelection(data, column, origin);
    if (!range) return false;
    const field = datasetHeader?.fields.find((item) => item.column === column);
    const reference = field ? `[${field.id}]` : selectionLabel(range);
    const separator = append && !/[=(,+\-*/]\s*$/.test(draft) ? "," : "";
    setDraft((current) => current + separator + reference);
    setFormulaReference({ ...range, tokenStart: draft.length + separator.length });
    setSuggestionIndex(0);
    return true;
  }, [data, datasetHeader, draft, editing, sourceRowOf]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      setCopyRange(undefined);
      copyBuffer.current = null;
      moveDrag.current = null;
      setMovePreview(null);
      updateCutStatus(null);
      return;
    }
    // Ctrl/Cmd+A selects the populated region first, then the whole sheet.
    if (command && key === "a") {
      event.preventDefault();
      const bounds = usedRangeBounds(data);
      const within = bounds
        ? (view
          // The populated region is stored rows, which are not a contiguous
          // display range under a local view: select every displayed row.
          ? { top: 0, left: Math.min(bounds.left, columnCount - 1), bottom: viewRowCount - 1, right: Math.min(bounds.right, columnCount - 1) }
          : { top: Math.min(bounds.top, rowCount - 1), left: Math.min(bounds.left, columnCount - 1), bottom: Math.min(bounds.bottom, rowCount - 1), right: Math.min(bounds.right, columnCount - 1) })
        : undefined;
      if (within && !(range.top === within.top && range.bottom === within.bottom && range.left === within.left && range.right === within.right)) {
        setSelection({ anchor: { row: within.top, column: within.left }, focus: { row: within.bottom, column: within.right } });
      } else selectWhole();
      return;
    }
    if (!command && event.key === "?") { event.preventDefault(); setShowShortcutHelp(true); return; }
    if (command && key === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (command && key === "f" && !event.shiftKey) {
      event.preventDefault();
      setFindPanel("find");
      return;
    }
    if (command && (key === "h" || (event.shiftKey && key === "f"))) {
      event.preventDefault();
      if (!readOnly) setFindPanel("replace");
      return;
    }
    if (command && event.shiftKey && key === "v") {
      pasteValuesNext.current = true;
      return;
    }
    if (command && key === "y") { event.preventDefault(); redo(); return; }
    if (command && !event.shiftKey && key === "d") { event.preventDefault(); fillDown(); return; }
    if (command && !event.shiftKey && key === "r") { event.preventDefault(); fillRight(); return; }
    // Ctrl/Cmd+; inserts today's date, Ctrl/Cmd+Shift+; the current time.
    if (command && event.key === ";") {
      event.preventDefault();
      writeActiveCell(new Date().toISOString().slice(0, 10));
      return;
    }
    if (command && event.key === ":") {
      event.preventDefault();
      writeActiveCell(new Date().toTimeString().slice(0, 5));
      return;
    }
    // Shift+Space selects the row(s), Ctrl/Cmd+Space the column(s), both the sheet.
    if (event.key === " " && (command || event.shiftKey)) {
      event.preventDefault();
      if (command && event.shiftKey) selectWhole();
      else if (command) setSelection({ anchor: { row: 0, column: range.left }, focus: { row: viewRowCount - 1, column: range.right } });
      else setSelection({ anchor: { row: range.top, column: 0 }, focus: { row: range.bottom, column: columnCount - 1 } });
      return;
    }
    // Ctrl/Cmd+Shift+= inserts and Ctrl/Cmd+- deletes when the selection
    // spans a full axis; the helpers no-op on read-only or bound grids.
    if (command && event.shiftKey && (event.key === "+" || event.key === "=")) {
      const fullRows = range.left === 0 && range.right === columnCount - 1;
      const fullColumns = range.top === 0 && range.bottom === viewRowCount - 1;
      if (fullRows || fullColumns) {
        event.preventDefault();
        if (fullRows) changeRows("insert");
        else changeColumns("insert");
      }
      return;
    }
    if (command && event.key === "-") {
      const fullRows = range.left === 0 && range.right === columnCount - 1;
      const fullColumns = range.top === 0 && range.bottom === viewRowCount - 1;
      if (fullRows || fullColumns) {
        event.preventDefault();
        if (fullRows) changeRows("delete");
        else changeColumns("delete");
      }
      return;
    }
    // Ctrl/Cmd+Backspace scrolls the active cell back into view (Excel).
    if (command && event.key === "Backspace") {
      event.preventDefault();
      reveal(selection.focus);
      return;
    }
    const navigation: Record<string, GridPoint> = {
      ArrowUp: { row: -1, column: 0 }, ArrowDown: { row: 1, column: 0 },
      ArrowLeft: { row: 0, column: -1 }, ArrowRight: { row: 0, column: 1 },
    };
    if (navigation[event.key]) {
      event.preventDefault();
      if (command) jumpToEdge(navigation[event.key], event.shiftKey);
      else move(navigation[event.key], event.shiftKey);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const bounds = usedRangeBounds(data);
      // The used range is stored rows; the selection moves in displayed rows.
      const endRow = view ? Math.min(viewRowCount - 1, Math.max(displayRowOf(bounds?.bottom ?? 0), 0)) : Math.min(rowCount - 1, bounds?.bottom ?? 0);
      const focus = event.key === "Home"
        ? (command ? { row: 0, column: 0 } : { row: selection.focus.row, column: 0 })
        : (command
          ? { row: endRow, column: Math.min(columnCount - 1, bounds?.right ?? 0) }
          : edgeOfData(hasCellValue, selection.focus, { row: 0, column: 1 }, viewRowCount, columnCount, keyFor));
      setSelection(event.shiftKey ? { anchor: selection.anchor, focus } : { anchor: focus, focus });
      queueMicrotask(() => reveal(focus));
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const page = Math.max(1, viewportRange.rowEnd - viewportRange.rowStart);
      move({ row: event.key === "PageDown" ? page : -page, column: 0 }, event.shiftKey);
      return;
    }
    if (event.key === "Tab") {
      // COMP-02.5: Tab walks right; at the last column it leaves the grid
      // rather than trapping focus, so the sheet stays one tab stop.
      const intent = tabIntent({ shiftKey: event.shiftKey, column: selection.focus.column, columnCount });
      if (intent === "move") {
        event.preventDefault();
        move({ row: 0, column: event.shiftKey ? -1 : 1 }, false);
      } else if (viewportRef.current && focusOutsideGrid(viewportRef.current, event.shiftKey)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // With a live copy marquee, Enter pastes the internal copy once and
      // dismisses it (Excel); otherwise Enter moves the selection down.
      if (!readOnly && copyRange && copyBuffer.current) {
        const pasted = pasteTsv(data, selection.focus, copyBuffer.current.tsv, viewRowCount, columnCount, canEdit, keyFor);
        const intended = beforeCellsChange ? pasteTargetChanges(data, selection.focus, parseTsv(copyBuffer.current.tsv), viewRowCount, columnCount, keyFor) : undefined;
        const outcome = commit(pasted.data, "Paste range", selectionAddresses(pasted.selection, keyFor), { source: "paste", intended });
        if (outcome.status !== "rejected") setSelection(pasted.selection);
        setCopyRange(undefined);
        copyBuffer.current = null;
        updateCutStatus(null);
        return;
      }
      move({ row: event.shiftKey ? -1 : 1, column: 0 }, false);
      return;
    }
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
      event.preventDefault(); setCopyRange(undefined); copyBuffer.current = null; updateCutStatus(null);
      if (!readOnly) {
        const intended = beforeCellsChange ? clearRangeTargets(data, selection, keyFor) : undefined;
        commit(clearSelection(data, selection, canEdit, keyFor), "Clear range", selectionAddresses(selection, keyFor), { source: "clear", intended });
      }
      return;
    }
    if (!command && !event.altKey && event.key.length === 1) {
      if (readOnly) return;
      event.preventDefault(); beginEdit(selection.focus, event.key);
    }
  };

  const clipboardPayloadFor = useCallback((source: GridSelection): SpreadsheetClipboardPayload => {
    const text = selectionToTsv(data, source, keyFor);
    const bounds = normaliseSelection(source);
    const columnIds: (string | undefined)[] = [];
    for (let column = bounds.left; column <= bounds.right; column += 1) columnIds.push(fieldIds[column]);
    return {
      text,
      values: parseTsv(text),
      range: { top: bounds.top, left: bounds.left, bottom: bounds.bottom, right: bounds.right, columnIds },
    };
  }, [data, fieldIds, keyFor]);

  /** Writes both clipboard channels: raw TSV plus the calculated-values channel Excel re-paste uses. */
  const writeClipboard = useCallback((event: React.ClipboardEvent, payload: SpreadsheetClipboardPayload, source: GridSelection) => {
    event.clipboardData.setData("text/plain", payload.text);
    // The calculated channel is keyed by displayed coordinate so the second
    // read lines up with the same selection; values come from the stored cell.
    const calculated = new Map<string, string>();
    const bounds = normaliseSelection(source);
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      for (let column = bounds.left; column <= bounds.right; column++) {
        const address = cellKeyAt(row, column);
        if (address === "") continue;
        const input = data.get(address) ?? "";
        const point = { row: sourceRowOf(row), column };
        calculated.set(cellKey({ row, column }), input.startsWith("=") ? displayValue(worksheet, point) : input);
      }
    }
    event.clipboardData.setData("application/x-sheetbase-values", selectionToTsv(calculated, source));
  }, [cellKeyAt, data, sourceRowOf, worksheet]);

  const onCopy = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const payload = clipboardPayloadFor(selection);
    const resolved = resolveClipboardPayload(clipboard?.onCopy?.(payload), payload);
    if (!resolved) return;
    writeClipboard(event, resolved, selection);
    copyBuffer.current = { tsv: resolved.text };
    setCopyRange(normaliseSelection(selection));
    updateCutStatus(null);
    announce(`Copied ${selectionLabel(selection)}`);
  };
  const onCut = (event: React.ClipboardEvent) => {
    event.preventDefault();
    if (readOnly) return;
    const payload = clipboardPayloadFor(selection);
    const resolved = resolveClipboardPayload(clipboard?.onCut?.(payload), payload);
    if (!resolved) return;
    writeClipboard(event, resolved, selection);
    copyBuffer.current = { tsv: resolved.text };
    setCopyRange(normaliseSelection(selection));
    updateCutStatus({ label: `Cut ${selectionLabel(selection)}`, range: resolved.range });
    announce(`Cut ${selectionLabel(selection)}`);
    const intended = beforeCellsChange ? clearRangeTargets(data, selection, keyFor) : undefined;
    commit(clearSelection(data, selection, canEdit, keyFor), "Cut range", selectionAddresses(selection, keyFor), { source: "clear", intended });
  };
  const onPaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    if (readOnly) { pasteValuesNext.current = false; return; }
    const values = event.clipboardData.getData("application/x-sheetbase-values");
    const asValues = pasteValuesNext.current && values !== "";
    pasteValuesNext.current = false;
    const sourceText = asValues ? values : event.clipboardData.getData("text/plain");
    const payload: SpreadsheetClipboardPayload = {
      text: sourceText,
      values: parseTsv(sourceText),
      range: { top: selection.focus.row, left: selection.focus.column, bottom: selection.focus.row, right: selection.focus.column, columnIds: [fieldIds[selection.focus.column]] },
    };
    const resolved = resolveClipboardPayload(clipboard?.onPaste?.(payload, { row: sourceRowOf(selection.focus.row), column: selection.focus.column }), payload);
    if (!resolved) return;
    const tsv = resolved.text;
    const rows = parseTsv(tsv);
    const pasteLabel = asValues ? "Paste values" : "Paste range";
    const totalCells = rows.reduce((sum, row) => sum + row.length, 0);
    const chunkRows = Math.max(1, Math.floor(PASTE_CHUNK_CELLS / Math.max(1, rows[0]?.length ?? 1)));
    if (totalCells <= PASTE_CHUNK_CELLS) {
      const pasted = pasteTsv(data, selection.focus, tsv, viewRowCount, columnCount, canEdit, keyFor);
      const intended = beforeCellsChange ? pasteTargetChanges(data, selection.focus, rows, viewRowCount, columnCount, keyFor) : undefined;
      const outcome = commit(pasted.data, pasteLabel, selectionAddresses(pasted.selection, keyFor), { source: "paste", intended });
      if (outcome.status !== "rejected") setSelection(pasted.selection);
      updateCutStatus(null);
      return;
    }
    // Large pastes apply in frame-sized slices so the viewport keeps painting.
    // The whole target set is gated once up front, so a host that refuses to
    // write partially rejects the operation before its first slice lands.
    if (beforeCellsChange) {
      const fullTargets = pasteTargetChanges(data, selection.focus, rows, viewRowCount, columnCount, keyFor);
      const preflight = resolveBeforeCellsChange(beforeCellsChange, { label: pasteLabel, cells: [], intended: fullTargets, columnWidths: [] }, "paste", datasetHeader);
      if (!preflight) { updateCutStatus(null); return; }
    }
    let working = data;
    let rowIndex = 0;
    let bottom = selection.focus.row;
    let right = selection.focus.column;
    const applyChunk = () => {
      const slice = rows.slice(rowIndex, rowIndex + chunkRows);
      const start = { row: selection.focus.row + rowIndex, column: selection.focus.column };
      const applied = applyTsvRows(working, start, slice, viewRowCount, columnCount, canEdit, keyFor);
      working = applied.data;
      commit(applied.data, pasteLabel, selectionAddresses(applied.selection, keyFor), { source: "paste" });
      rowIndex += slice.length;
      bottom = Math.max(bottom, applied.selection.focus.row);
      right = Math.max(right, applied.selection.focus.column);
      announce(`Pasting ${Math.min(rowIndex, rows.length)} of ${rows.length} rows`);
      if (rowIndex < rows.length) {
        window.setTimeout(applyChunk, 0);
        return;
      }
      updateCutStatus(null);
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

  const resizeColumnWithKeys = (column: number, event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const before = columnWidths[column];
    const after = Math.max(72, Math.min(480, before + (event.key === "ArrowRight" ? 8 : -8)));
    if (after === before) return;
    const next = [...columnWidths];
    next[column] = after;
    setColumnWidths(next);
    pushHistory(columnWidthMutation({ column, before, after }));
    onColumnWidthsChange?.(next);
  };

  const resizeRowWithKeys = (row: number, event: React.KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    const source = sourceRowOf(row);
    if (source < 0) return;
    const before = rowHeights[source] ?? defaultRowHeight;
    const after = Math.max(20, Math.min(240, before + (event.key === "ArrowDown" ? 8 : -8)));
    if (after === before) return;
    const next = [...rowHeights];
    next[source] = after;
    setRowHeights(next);
    onRowHeightsChange?.(next);
  };

  const resizeRow = (row: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const source = sourceRowOf(row);
    if (source < 0) return;
    const startY = event.clientY;
    const startHeight = rowHeights[source] ?? defaultRowHeight;
    let finalHeight = startHeight;
    const onMove = (moveEvent: PointerEvent) => {
      finalHeight = Math.max(20, Math.min(240, startHeight + moveEvent.clientY - startY));
      const height = finalHeight;
      setRowHeights((current) => {
        if (current[source] === height) return current;
        const next = [...current];
        next[source] = height;
        return next;
      });
    };
    const onUp = () => {
      if (finalHeight !== startHeight) {
        const next = [...rowHeights]; next[source] = finalHeight; onRowHeightsChange?.(next);
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
        // The reference names a data cell, so it is recorded in source space
        // and only the overlay is positioned in displayed rows.
        const source = { row: sourceRowOf(point.row), column: point.column };
        if (source.row < 0) return;
        const next = {
          anchor: source,
          focus: source,
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
      // Pressing inside the selection within a few pixels of its border arms
      // an Excel-style drag-move instead of re-anchoring the selection.
      if (
        !readOnly && !editing
        && point.row >= range.top && point.row <= range.bottom
        && point.column >= range.left && point.column <= range.right
      ) {
        const cellBox = event.currentTarget.getBoundingClientRect();
        const x = rowHeaderWidth + columnOffsets[point.column] + (event.clientX - cellBox.left);
        const y = headerHeight + datasetHeaderHeight + rowOffsets[point.row] + (event.clientY - cellBox.top);
        const edge = Math.min(
          x - (rowHeaderWidth + columnOffsets[range.left]),
          rowHeaderWidth + columnOffsets[range.right + 1] - x,
          y - (headerHeight + datasetHeaderHeight + rowOffsets[range.top]),
          headerHeight + datasetHeaderHeight + rowOffsets[range.bottom + 1] - y,
        );
        if (edge <= 5) {
          moveDrag.current = { range, origin: point, target: { row: range.top, column: range.left } };
          viewportRef.current?.focus({ preventScroll: true });
          return;
        }
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
        const source = { row: sourceRowOf(point.row), column: point.column };
        if (source.row >= 0) updateFormulaReference({ ...formulaReference, focus: source });
        return;
      }
      if (moveDrag.current) {
        const drag = moveDrag.current;
        const height = drag.range.bottom - drag.range.top + 1;
        const width = drag.range.right - drag.range.left + 1;
        const top = Math.max(0, Math.min(Math.max(0, viewRowCount - height), drag.range.top + point.row - drag.origin.row));
        const left = Math.max(0, Math.min(Math.max(0, columnCount - width), drag.range.left + point.column - drag.origin.column));
        drag.target = { row: top, column: left };
        setMovePreview({ top, left, bottom: top + height - 1, right: left + width - 1 });
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
        commitMutation(cellChangesMutation("Revert failed write", [{ address, before: data.get(address), after: writeState.before }]), { emitFieldWrites: false, source: "revert" });
        setWriteStates((current) => { const next = new Map(current); next.delete(address); return next; });
      } else if (writeState.status === "failed" || writeState.status === "conflict") runFieldWrite(writeState.write, writeState.before);
    },
  };

  // biome-ignore lint/a11y/useSemanticElements: virtualised grid — rows and cells are absolutely positioned divs, so the ARIA grid pattern on divs (single tab stop on the container) is the sanctioned approach; table elements are incompatible with virtualisation
  return <div
    className={`sheetbase-scope spreadsheet${readOnly ? " spreadsheet-read-only" : ""}`}
    data-theme={theme}
    ref={viewportRef}
    tabIndex={0}
    role="grid"
    aria-readonly={readOnly || undefined}
    aria-rowcount={viewRowCount}
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
    <div className="grid-canvas" style={{ width: contentWidth, height: contentHeight, backgroundSize: `140px ${defaultRowHeight}px` }}>
      {renderRows.flatMap((row) => renderColumns.map(({ index: column }) => {
        const point = { row, column };
        // Displayed rows resolve to the stored row that owns the value.
        const sourceRow = sourceRowOf(row);
        const key = sourceRow < 0 ? "" : cellKey({ row: sourceRow, column });
        const field = fieldByColumn.get(column);
        const derived = field?.source === "dataset" || field?.source === "calc";
        const active = samePoint(point, selection.focus);
        const selected = row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
        const raw = data.get(key) ?? "";
        // Dynamic-array children have no `data` entry; resolve them through the
        // worksheet spill store so SEQUENCE/UNIQUE/SORT results actually paint.
        const spilled = raw === "" ? worksheet.spills.value(key) : undefined;
        const loading = raw === "" && spilled === undefined && loadingRanges.some((loadingRange) => sourceRow >= loadingRange.rowStart && sourceRow <= loadingRange.rowEnd && column >= loadingRange.columnStart && column <= loadingRange.columnEnd);
        const writeState = writeStates.get(key);
        const annotationRecordId = bound ? datasetHeader?.recordIdForRow?.(sourceRow) : undefined;
        const annotationFieldId = fieldIds[column];
        const annotation = bound
          ? ((annotationRecordId !== undefined && annotationFieldId !== undefined
              ? annotationMaps.byRecord.get(`${annotationRecordId}\u0000${annotationFieldId}`)
              : undefined) ?? annotationMaps.byAddressKeyed.get(key))
          : annotationMaps.byAddressAll.get(key);
        const sourcePoint = { row: sourceRow, column };
        const baseFormat = formats.get(sourcePoint);
        const calculated = raw.startsWith("=") || spilled !== undefined ? displayValue(worksheet, sourcePoint) : raw;
        // Empty rules are the common case — skip the per-cell scan entirely.
        const conditionalFormat = conditionalFormats.length
          ? resolveConditionalFormat(sourcePoint, calculated, fieldIds[column], conditionalFormats, (conditionFieldId) => {
            const conditionColumn = columnByFieldId.get(conditionFieldId) ?? -1;
            if (conditionColumn < 0) return "";
            const conditionKey = cellKey({ row: sourceRow, column: conditionColumn });
            const conditionRaw = data.get(conditionKey) ?? "";
            return conditionRaw.startsWith("=") ? displayValue(worksheet, { row: sourceRow, column: conditionColumn }) : conditionRaw;
          })
          : undefined;
        const format = conditionalFormat ? { ...baseFormat, ...conditionalFormat } : baseFormat;
        const value = formatCellDisplay(calculated, format, columnDisplay[column]);
        const resolvedState = cellState ? resolveCellState(cellState(sourceRow, column)) : undefined;
        // A host label wins over the built-in rendering (and over the
        // boolean checkbox, which reads the stored literal).
        const label = field?.displayText?.(calculated);
        // A conflict replaces the value with the design's "2 values" copy.
        const display = resolvedState?.state === "conflict"
          ? conflictValueLabel(resolvedState.count ?? 2)
          : label ?? value;
        const booleanValue = resolvedState === undefined && label === undefined
          ? booleanCellValue(field?.dataType, calculated)
          : undefined;
        // Excel-style overflow: single-line text paints across adjacent
        // empty cells. The span clips itself at the first populated,
        // spilled, or still-loading neighbour.
        let overflow: { left: number; right: number } | undefined;
        if (resolvedState === undefined && booleanValue === undefined && value !== "" && !value.includes("\n") && !renderCell && !loading) {
          const neighbourEmpty = (displayRow: number, c: number) => {
            const neighbourKey = cellKeyAt(displayRow, c);
            if (neighbourKey === "") return false;
            const neighbourSource = sourceRowOf(displayRow);
            return (data.get(neighbourKey) ?? "") === ""
              && worksheet.spills.value(neighbourKey) === undefined
              && !loadingRanges.some((entry) => neighbourSource >= entry.rowStart && neighbourSource <= entry.rowEnd && c >= entry.columnStart && c <= entry.columnEnd);
          };
          let right = 0;
          if (format?.horizontalAlign !== "right") {
            for (let c = column + 1; c < columnCount && c - column <= 12; c++) {
              if (!neighbourEmpty(row, c)) break;
              right += columnWidths[c];
            }
          }
          let left = 0;
          if (format?.horizontalAlign === "right" || format?.horizontalAlign === "center") {
            for (let c = column - 1; c >= 0 && column - c <= 12; c--) {
              if (!neighbourEmpty(row, c)) break;
              left += columnWidths[c];
            }
          }
          if (left > 0 || right > 0) overflow = { left, right };
        }
        return <GridCell
          key={key}
          address={key}
          row={row}
          column={column}
          display={display}
          booleanValue={booleanValue}
          isFormula={raw.startsWith("=")}
          selected={selected}
          active={active}
          loading={loading}
          className={`grid-cell${loading ? " loading-cell" : ""}${derived ? " dataset-derived" : ""}${row < frozenRowCount ? " frozen-row" : ""}${row === frozenRowCount - 1 ? " freeze-row-edge" : ""}${column < frozenColumnCount ? " frozen-column" : ""}${column === frozenColumnCount - 1 ? " freeze-column-edge" : ""}${row > 0 && rowHeightAt(row - 1) === 0 ? " after-hidden-row" : ""}${column > 0 && columnWidths[column - 1] === 0 ? " after-hidden-column" : ""}${writeState ? ` write-${writeState.status}` : ""}${annotation ? " annotated" : ""}${!canEdit(point) ? " read-only" : ""}${selected ? " in-selection" : ""}${active ? " active-cell" : ""}${overflow ? " spills" : ""}${cellStateClassName(resolvedState)}${row === appendDisplayIndex && draftRow ? " draft-row" : ""}`}
          title={annotation ? [annotation.author, annotation.text].filter(Boolean).join(": ") : undefined}
          format={format}
          overflow={overflow}
          field={field}
          writeState={writeState}
          cellState={resolvedState}
          renderCell={renderCell}
          handlers={cellHandlersRef}
          left={columnLeft(column)}
          top={row < frozenRowCount ? `calc(var(--sheet-scroll-top, 0px) + ${headerHeight + datasetHeaderHeight + rowOffsets[row]}px)` : headerHeight + datasetHeaderHeight + rowOffsets[row]}
          width={columnWidths[column]}
          height={rowHeightAt(row)}
        />;
      }))}

      {renderRows.map((row) => {
        const isAppendRow = appendInRows && row === appendDisplayIndex;
        return (
        // biome-ignore lint/a11y/useSemanticElements: virtualised grid — header roles on divs are the sanctioned ARIA pattern here
        <div
        role="rowheader"
        tabIndex={-1}
        aria-label={isAppendRow ? appendRowLabel(appendRow) : String(row + 1)}
        aria-selected={!isAppendRow && row >= range.top && row <= range.bottom}
        className={`row-header${!isAppendRow && row >= range.top && row <= range.bottom ? " selected-header" : ""}${isAppendRow ? " append-row-header" : ""}`}
        key={`row-${row}`}
        style={{ left: "var(--sheet-scroll-left, 0px)", top: headerHeight + datasetHeaderHeight + rowOffsets[row], width: rowHeaderWidth, height: rowHeightAt(row) }}
        onPointerDown={() => {
          if (isAppendRow) { selectAppendRow(); return; }
          dragSelecting.current = true;
          setSelection({ anchor: { row, column: 0 }, focus: { row, column: columnCount - 1 } });
          viewportRef.current?.focus({ preventScroll: true });
        }}
        onContextMenu={(event) => { event.preventDefault(); if (!isAppendRow) setContextMenu({ axis: "row", index: row, x: event.clientX, y: event.clientY }); }}
      >{isAppendRow ? (draftRow ? "new" : "+") : row + 1}{!isAppendRow && <hr className="row-resizer" aria-orientation="horizontal" aria-label={`Resize row ${row + 1}`} aria-valuenow={rowHeightAt(row)} aria-valuemin={20} aria-valuemax={240} tabIndex={0} onPointerDown={(event) => resizeRow(row, event)} onKeyDown={(event) => resizeRowWithKeys(row, event)} onDoubleClick={(event) => { event.stopPropagation(); autoFitRow(row); }} />}</div>);
      })}

      {appendDisplayIndex !== undefined && (appendInRows || appendBeyond) && !draftRow && (
        // biome-ignore lint/a11y/useSemanticElements: virtualised grid — the append row is an absolutely positioned div like every other cell
        <div
          className="grid-cell append-row"
          role="gridcell"
          tabIndex={-1}
          aria-label={appendRowLabel(appendRow)}
          style={{ left: rowHeaderWidth, top: headerHeight + datasetHeaderHeight + rowOffsets[appendDisplayIndex], width: Math.max(contentWidth - rowHeaderWidth, 0), height: rowHeights[appendSourceRow] ?? defaultRowHeight }}
          onPointerDown={(event) => { event.stopPropagation(); selectAppendRow(); }}
        >{appendRowLabel(appendRow)}</div>
      )}

      {columnGroups?.map((group) => {
        const cols = group.columns.filter((column) => column >= 0 && column < columnCount);
        if (cols.length === 0) return null;
        const start = Math.min(...cols);
        const end = Math.max(...cols);
        let width = 0;
        for (let column = start; column <= end; column += 1) width += columnWidths[column] ?? 0;
        return (
          <div
            key={`group-${group.label}`}
            role="presentation"
            className="column-group-header"
            style={{ left: columnLeft(start), top: "var(--sheet-scroll-top, 0px)", width, height: datasetHeaderHeight }}
          >
            {group.label}
          </div>
        );
      })}

      {renderColumns.map(({ index: column }) => {
        const field = fieldByColumn.get(column);
        const computed = Boolean(field?.computed) || computedColumns.has(column);
        const showComputedMark = showsComputedMark(computed, field?.source, field?.sourceLabel);
        return (
        // biome-ignore lint/a11y/useSemanticElements: virtualised grid — header roles on divs are the sanctioned ARIA pattern here
        <div
        role="columnheader"
        tabIndex={-1}
        aria-label={`${columnLabel(column)} ${field?.label ?? columnLabel(column)}`}
        aria-selected={column >= range.left && column <= range.right}
        className={`column-header${column >= range.left && column <= range.right ? " selected-header" : ""}${column > 0 && columnWidths[column - 1] === 0 ? " after-hidden-column" : ""}`}
        key={`column-${column}`}
        draggable={Boolean(onColumnMove)}
        style={{
          left: columnLeft(column),
          top: `calc(var(--sheet-scroll-top, 0px) + ${datasetHeaderHeight}px)`,
          width: columnWidths[column],
          height: headerHeight,
        }}
        onPointerDown={(event) => {
          if (editing && draft.startsWith("=")) {
            event.preventDefault();
            event.stopPropagation();
            selectFormulaColumn(column, event.metaKey || event.ctrlKey);
            return;
          }
          dragSelecting.current = true;
          setSelection({ anchor: { row: 0, column }, focus: { row: viewRowCount - 1, column } });
          viewportRef.current?.focus({ preventScroll: true });
        }}
        onContextMenu={(event) => { event.preventDefault(); setContextMenu({ axis: "column", index: column, x: event.clientX, y: event.clientY }); }}
        onDragStart={(event) => { event.dataTransfer.setData("application/x-sheetbase-column", String(column)); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => { if (onColumnMove) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("application/x-sheetbase-column")); if (Number.isInteger(from) && from !== column) onColumnMove?.(from, column); }}
      >
        <span className="column-coordinate">{columnLabel(column)}</span>
        <span className="column-heading">
          <span className="column-name">{field?.label ?? columnLabel(column)}</span>
          {field?.source && <SourceBadge source={field.source} label={field.sourceLabel} />}
        </span>
        {showComputedMark && <span className="fx column-fx" aria-hidden="true">{CALC_SOURCE_LABEL}</span>}
        {fieldIds[column] && <button type="button"
          className={`column-sort${query.sort?.some((sort) => sort.fieldId === fieldIds[column]) ? " active" : ""}`}
          aria-label={`Sort ${fieldIds[column]}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const fieldId = fieldIds[column];
            if (!fieldId) return;
            const current = query.sort?.find((sort) => sort.fieldId === fieldId)?.direction;
            const next = current === undefined ? "asc" : current === "asc" ? "desc" : undefined;
            if (sortMode === "local" && !bound) {
              // Reordering rows moves values between addresses; the mutation
              // must not emit field writes against the wrong records. Bound
              // grids sort server-side via the query change below.
              if (next) {
                if (!sortBaselineRef.current) sortBaselineRef.current = data;
                commit(sortGridRows(sortBaselineRef.current, column, next), `Sort ${fieldId} ${next === "asc" ? "ascending" : "descending"}`, undefined, { emitFieldWrites: false, source: "sort" });
              } else if (sortBaselineRef.current) {
                commit(sortBaselineRef.current, `Clear ${fieldId} sort`, undefined, { emitFieldWrites: false, source: "sort" });
                sortBaselineRef.current = undefined;
              }
            }
            const otherSorts = (query.sort ?? []).filter((sort) => sort.fieldId !== fieldId);
            applyQuery({ ...query, sort: next ? [...otherSorts, { fieldId, direction: next }] : otherSorts });
          }}
        >{query.sort?.find((sort) => sort.fieldId === fieldIds[column])?.direction === "asc" ? "▲" : query.sort?.find((sort) => sort.fieldId === fieldIds[column])?.direction === "desc" ? "▼" : "↕"}</button>}
        <hr className="column-resizer" aria-orientation="vertical" aria-label={`Resize column ${columnLabel(column)}`} aria-valuenow={columnWidths[column]} aria-valuemin={72} aria-valuemax={480} tabIndex={0} onPointerDown={(event) => resizeColumn(column, event)} onKeyDown={(event) => resizeColumnWithKeys(column, event)} onDoubleClick={(event) => { event.stopPropagation(); autoFitColumn(column); }} />
      </div>);
      })}

      {findPanel && <search className="find-panel">
        <input ref={focusOnMount} aria-label="Find" placeholder="Find" value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findText(findQuery); }} />
        {findPanel === "replace" && <input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findText(findQuery); }} />}
        <button type="button" onClick={() => findText(findQuery)}>Find</button>
        {findPanel === "find" && !readOnly && <button type="button" onClick={() => setFindPanel("replace")}>Replace…</button>}
        {findPanel === "replace" && !readOnly && <button type="button" onClick={() => replaceAll(findQuery, replacement)}>Replace all</button>}
        <button type="button" aria-label="Close find" onClick={() => { setFindPanel(undefined); viewportRef.current?.focus(); }}>×</button>
      </search>}
      {contextMenu?.axis === "column" && <ColumnContextMenu x={contextMenu.x} y={contextMenu.y} column={contextMenu.index} field={datasetHeader?.fields.find((field) => field.column === contextMenu.index)} query={query} onQueryChange={applyQuery} actions={contextMenuActions} headerActions={columnMenuItems} onAutoFit={() => { autoFitColumn(contextMenu.index); closeContextMenu(); }} onMove={onColumnMove ? (direction) => { const target = contextMenu.index + direction; if (target >= 0 && target < columnCount) onColumnMove(contextMenu.index, target); closeContextMenu(); } : undefined} onHide={fieldIds[contextMenu.index] && onColumnVisibilityChange ? () => { const fieldId = fieldIds[contextMenu.index]; if (!fieldId) return; onColumnVisibilityChange(fieldId, false); closeContextMenu(); } : undefined} onFreeze={() => { const count = contextMenu.index + 1; setFrozenColumnCount(count); onFrozenColumnsChange?.(count); closeContextMenu(); }} onUnfreeze={frozenColumnCount ? () => { setFrozenColumnCount(0); onFrozenColumnsChange?.(0); closeContextMenu(); } : undefined} onFormat={onConditionalFormattingRequest ? () => { onConditionalFormattingRequest(fieldIds[contextMenu.index], contextMenu.index); closeContextMenu(); } : undefined} onClose={closeContextMenu} />}
      {contextMenu?.axis === "row" && <div className="grid-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="Row menu" tabIndex={-1} ref={focusOnMount} onKeyDown={menuKeys(closeContextMenu)} onPointerDown={(event) => event.stopPropagation()}>
        {!readOnly && !bound && <button type="button" onClick={() => { contextMenu.axis === "row" ? changeRows("insert", contextMenu.index, 1) : changeColumns("insert", contextMenu.index, 1); closeContextMenu(); }}>Insert before</button>}
        {!readOnly && !bound && <button type="button" onClick={() => { contextMenu.axis === "row" ? changeRows("insert", contextMenu.index + 1, 1) : changeColumns("insert", contextMenu.index + 1, 1); closeContextMenu(); }}>Insert after</button>}
        {!readOnly && !bound && <button type="button" onClick={() => { contextMenu.axis === "row" ? changeRows("delete", contextMenu.index, 1) : changeColumns("delete", contextMenu.index, 1); closeContextMenu(); }}>Delete {contextMenu.axis}</button>}
        {contextMenu.axis === "row" && <button type="button" onClick={() => { autoFitRow(contextMenu.index); closeContextMenu(); }}>Auto-fit row</button>}
        {contextMenu.axis === "row" && <button type="button" onClick={() => { const source = sourceRowOf(contextMenu.index); if (source < 0) { closeContextMenu(); return; } const next = [...rowHeights]; next[source] = 0; setRowHeights(next); onRowHeightsChange?.(next); closeContextMenu(); }}>Hide row</button>}
        {contextMenu.axis === "row" && contextMenu.index > 0 && rowHeightAt(contextMenu.index - 1) === 0 && <button type="button" onClick={() => { const source = sourceRowOf(contextMenu.index - 1); if (source < 0) { closeContextMenu(); return; } const next = [...rowHeights]; next[source] = defaultRowHeight; setRowHeights(next); onRowHeightsChange?.(next); closeContextMenu(); }}>Unhide previous row</button>}
        {contextMenu.axis === "row" && <button type="button" onClick={() => { setFrozenRowCount(contextMenu.index + 1); closeContextMenu(); }}>Freeze through row</button>}
        {(frozenRowCount > 0 || frozenColumnCount > 0) && <button type="button" onClick={() => { setFrozenRowCount(0); setFrozenColumnCount(0); closeContextMenu(); }}>Unfreeze panes</button>}
        {enabledMenuActions(contextMenuActions).map((action) => <button type="button" key={action.id ?? action.label} onClick={() => { action.onSelect({ axis: "row", index: contextMenu.index }); closeContextMenu(); }}>{action.label}</button>)}
      </div>}


      <div className="grid-corner" style={{ left: "var(--sheet-scroll-left, 0px)", top: "var(--sheet-scroll-top, 0px)", width: rowHeaderWidth, height: headerHeight + datasetHeaderHeight }}
        title="Select all (Ctrl/Cmd+A)"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          selectWhole();
          viewportRef.current?.focus({ preventScroll: true });
        }}
      />
      <div className={`selection-outline${fillTarget ? " filling" : ""}${selectionIsCopySource ? " copied" : ""}`} style={{
        left: columnLeft(previewRange.left),
        top: headerHeight + datasetHeaderHeight + rowOffsets[previewRange.top],
        width: columnOffsets[previewRange.right + 1] - columnOffsets[previewRange.left],
        height: rowOffsets[previewRange.bottom + 1] - rowOffsets[previewRange.top],
      }}>
        {!readOnly && <button type="button"
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
          onDoubleClick={(event) => {
            // Excel: double-click fills down to the bottom of the tallest
            // contiguous data run in a column adjacent to the selection.
            event.preventDefault();
            event.stopPropagation();
            fillOrigin.current = null;
            const extent = (column: number) => {
              if (column < 0 || column >= columnCount) return range.bottom;
              let row = range.bottom;
              while (row + 1 < viewRowCount && hasCellValue(cellKeyAt(row + 1, column))) row++;
              return row;
            };
            const targetRow = Math.max(extent(range.left - 1), extent(range.right + 1));
            if (targetRow <= range.bottom) return;
            const filled = fillSelection(data, selection, { row: targetRow, column: range.right }, viewRowCount, columnCount, canEdit, keyFor);
            const outcome = commit(filled.data, "Autofill", selectionAddresses(filled.selection, keyFor), { source: "fill", intended: filled.intended });
            if (outcome.status !== "rejected") setSelection(filled.selection);
          }}
        />}
      </div>

      {copyBox && <svg
        className="copy-outline"
        aria-hidden="true"
        style={{
          left: columnLeft(copyBox.left),
          top: headerHeight + datasetHeaderHeight + rowOffsets[copyBox.top],
          width: columnOffsets[copyBox.right + 1] - columnOffsets[copyBox.left],
          height: rowOffsets[copyBox.bottom + 1] - rowOffsets[copyBox.top],
        }}
      >
        <rect />
      </svg>}

      {movePreview && <div
        className="move-outline"
        aria-hidden="true"
        style={{
          left: columnLeft(movePreview.left),
          top: headerHeight + datasetHeaderHeight + rowOffsets[movePreview.top],
          width: columnOffsets[movePreview.right + 1] - columnOffsets[movePreview.left],
          height: rowOffsets[movePreview.bottom + 1] - rowOffsets[movePreview.top],
        }}
      />}

      {spillBox && <div
        className="spill-range"
        aria-hidden="true"
        style={{
          left: columnLeft(spillBox.left),
          top: headerHeight + datasetHeaderHeight + rowOffsets[spillBox.top],
          width: columnOffsets[spillBox.right + 1] - columnOffsets[spillBox.left],
          height: rowOffsets[spillBox.bottom + 1] - rowOffsets[spillBox.top],
        }}
      />}

      {displayedReferenceRanges.map((reference, index) => {
        const referenceRange = normaliseSelection(reference);
        // References name stored cells; paint them where their rows show.
        const top = displayRowOf(referenceRange.top);
        const bottom = Math.min(displayRowOf(referenceRange.bottom), viewRowCount - 1);
        if (top < 0 || bottom < top || referenceRange.left >= columnCount) return null;
        const right = Math.min(referenceRange.right, columnCount - 1);
        return <div
        className={`formula-reference${suggestedRange === reference ? " suggested" : ""}`}
        key={`reference-${top}-${referenceRange.left}-${bottom}-${right}`}
        style={{
          left: columnLeft(referenceRange.left),
          top: headerHeight + datasetHeaderHeight + rowOffsets[top],
          width: columnOffsets[right + 1] - columnOffsets[referenceRange.left],
          height: rowOffsets[bottom + 1] - rowOffsets[top],
          borderColor: ["var(--ref-1)", "var(--ref-2)", "var(--ref-3)", "var(--ref-4)"][index % 4],
        }}
      />;
      })}
      {editing && draft.startsWith("=") && <FormulaTokens value={draft} className="cell-formula-tokens" style={{
        left: columnLeft(editing.column, 1),
        top: headerHeight + datasetHeaderHeight + rowOffsets[editing.row] + 1,
        width: columnWidths[editing.column] - 2,
        height: rowHeightAt(editing.row) - 2,
      }} />}
      {editing && !activeCustomEditor && <input
        className={`cell-editor${draft.startsWith("=") ? " tokenised-input" : ""}`}
        ref={focusOnMount}
        type={!draft.startsWith("=") && editingField?.dataType === "number" ? "number" : !draft.startsWith("=") && editingField?.dataType === "date" ? "date" : editingField?.dataType === "datetime" ? "datetime-local" : "text"}
        aria-invalid={validationError ? true : undefined}
        aria-activedescendant={suggestions.length > 0 ? `formula-suggestion-${suggestionIndex}` : undefined}
        value={draft}
        aria-label={`Edit ${cellKeyAt(editing.row, editing.column)}`}
        style={{
          left: columnLeft(editing.column, 1),
          top: headerHeight + datasetHeaderHeight + rowOffsets[editing.row] + 1,
          width: columnWidths[editing.column] - 2,
          height: rowHeightAt(editing.row) - 2,
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
          if (event.key === "Tab") {
            event.preventDefault();
            const intent = tabIntent({ shiftKey: event.shiftKey, column: editing.column, columnCount });
            if (intent === "move") {
              finishEdit(true, { row: 0, column: event.shiftKey ? -1 : 1 });
            } else {
              const backwards = event.shiftKey;
              finishEdit(true);
              queueMicrotask(() => { if (viewportRef.current) focusOutsideGrid(viewportRef.current, backwards); });
            }
          }
        }}
      />}
      {editing && activeCustomEditor && <div
        className="cell-editor custom-editor-host"
        style={{
          left: columnLeft(editing.column, 1),
          top: headerHeight + datasetHeaderHeight + rowOffsets[editing.row] + 1,
          width: columnWidths[editing.column] - 2,
          height: rowHeightAt(editing.row) - 2,
        }}
      >
        {activeCustomEditor.render({
          point: editing,
          address: cellKeyAt(editing.row, editing.column),
          columnId: editingColumnId,
          field: editingField,
          storedValue: data.get(cellKeyAt(editing.row, editing.column)) ?? "",
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
      {editing && !(editingField?.multiple && editingField.options) && !activeCustomEditor && !draft.startsWith("=") && (editingField?.dataType === "boolean" || editingField?.dataType === "relationship" || Boolean(editingField?.options?.length)) && (editingField?.dataType === "boolean" ? <div
        className="typed-options boolean"
        role="radiogroup"
        aria-label={`Choose ${editingField.label}`}
        style={{ left: columnLeft(editing.column), top: headerHeight + datasetHeaderHeight + rowOffsets[Math.min(editing.row + 1, viewRowCount)] + 3, width: Math.max(columnWidths[editing.column], 180) }}
      >
        {(editingField?.options ?? ["true", "false"]).map((option) => (
            // biome-ignore lint/a11y/useSemanticElements: button-as-radio inside a radiogroup is the intended pattern; a native input would not preserve editor focus or the button styling
            <button type="button"
            role="radio"
            aria-checked={draft.toLocaleLowerCase() === option.toLocaleLowerCase()}
            className={draft.toLocaleLowerCase() === option.toLocaleLowerCase() ? "active" : ""}
            key={option}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => finishEdit(true, undefined, option)}
          >{option === "true" ? "✓ Yes" : "No"}</button>))}
      </div> : <div
        className={`typed-options ${editingField?.dataType ?? "text"}`}
        role="listbox"
        aria-label={`Choose ${editingField?.label}`}
        style={{ left: columnLeft(editing.column), top: headerHeight + datasetHeaderHeight + rowOffsets[Math.min(editing.row + 1, viewRowCount)] + 3, width: Math.max(columnWidths[editing.column], 180) }}
      >
        {(editingField?.options ?? []).flatMap((option) => editingField?.dataType !== "relationship" || draft === "" || option.toLocaleLowerCase().includes(draft.toLocaleLowerCase()) ? [<button type="button"
            role="option"
            aria-selected={draft === option}
            className={draft.toLocaleLowerCase() === option.toLocaleLowerCase() ? "active" : ""}
            key={option}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => finishEdit(true, undefined, option)}
          >{option}</button>] : [])}
      </div>)}
      {editing && validationError && <div className="cell-validation" role="alert" style={{ left: columnLeft(editing.column), top: headerHeight + datasetHeaderHeight + rowOffsets[Math.min(editing.row + 1, viewRowCount)] + 3 }}>{validationError}</div>}
      {showShortcutHelp && <div className="shortcut-backdrop"><section ref={shortcutHelpRef} className="shortcut-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}>
        <header><strong>Keyboard shortcuts</strong><button type="button" aria-label="Close shortcuts" onClick={() => { setShowShortcutHelp(false); viewportRef.current?.focus(); }}>×</button></header>
        <dl><dt>Edit cell</dt><dd>F2 or type</dd><dt>Move through sheet</dt><dd>Arrows · Enter · Tab · Page Up/Down</dd><dt>Jump to data edge</dt><dd>Ctrl/Cmd + arrows</dd><dt>Select all</dt><dd>Ctrl/Cmd A or corner</dd><dt>Select row / column</dt><dd>Shift Space · Ctrl Space</dd><dt>Paste copied range</dt><dd>Enter</dd><dt>Move cells</dt><dd>Drag selection border</dd><dt>Fill down / right</dt><dd>Ctrl/Cmd D · R</dd><dt>Insert date / time</dt><dd>Ctrl/Cmd ; · Shift :</dd><dt>Insert / delete axis</dt><dd>Ctrl/Cmd Shift + · Ctrl/Cmd −</dd><dt>Find</dt><dd>Ctrl/Cmd F</dd><dt>Find and replace</dt><dd>Ctrl/Cmd Shift F</dd><dt>Undo / redo</dt><dd>Ctrl/Cmd Z · Shift Z</dd><dt>Paste values</dt><dd>Ctrl/Cmd Shift V</dd><dt>Absolute reference</dt><dd>F4</dd><dt>Extend selection</dt><dd>Shift + arrows</dd><dt>Column menu</dt><dd>Menu or Shift F10</dd></dl>
      </section></div>}
      {editing && suggestions.length > 0 && <div className="formula-suggestions" role="listbox" aria-label="Formula suggestions" style={{
        left: columnLeft(editing.column),
        top: headerHeight + datasetHeaderHeight + rowOffsets[Math.min(editing.row + 1, viewRowCount)] + 4,
        width: Math.max(290, columnWidths[editing.column]),
      }}>
        {suggestions.map((suggestion, index) => <button type="button"
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
