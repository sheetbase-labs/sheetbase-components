import type { ReactNode } from "react";
import type { BindingResolver, CellBinding, CellFormat, CellRange, RangeStore } from "../engine";
import type { CellDataType, GridPoint, GridSelection } from "../grid/model";
import type { GridMutation } from "../grid/mutations";
import type { ConditionalFormatRule } from "../grid/conditional-formatting";
import type { CellAnnotation } from "./annotations";
import type { DatasetQuery, FilterClause } from "../data";

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
export type SpreadsheetFormatEntry = Readonly<{ range: CellRange; value: CellFormat }>;
export type DatasetHeaderConfig = Readonly<{
  datasetId?: string;
  recordIdForRow?(row: number): string | undefined;
  fields: readonly Readonly<{ id: string; label: string; column: number; writable?: boolean; computed?: boolean; dataType?: CellDataType; required?: boolean; options?: readonly string[]; multiple?: boolean; unit?: string; precision?: number; numberFormat?: CellFormat["numberFormat"] }>[];
}>;
export type FieldWrite = Readonly<{ address: string; row: number; datasetId?: string; recordId?: string; fieldId: string; value: string }>;
export type WriteStatus = "pending" | "saved" | "conflict" | "failed";

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
