import type { DatasetQuery, FilterClause, FilterNode } from "@sheetbase-labs/sheetbase-shared";
import { buildPredicate, matchClauses } from "@sheetbase-labs/sheetbase-shared";
import { cellKey, type GridPoint } from "./model";

/**
 * Local (view-level) ordering and filtering for identity-keyed bound grids.
 *
 * A bound grid owns no row identity: rows are records and every write resolves
 * its record through `datasetHeader.recordIdForRow`. Sorting or filtering by
 * moving values between addresses would desync that mapping, so a bound grid
 * never reorders its data. Instead this module derives a *view*: an ordered
 * list of source rows to display, plus the inverse lookup. `data` never moves,
 * so record identity — and every bound write — stays intact.
 *
 * The functions here are pure (no React, no DOM) so the ordering and filter
 * semantics are unit-testable on their own.
 */

/** A display → source row mapping. `rows[n]` is the source row shown at row `n`. */
export type GridView = Readonly<{
  /** Display row index → source row index. */
  rows: readonly number[];
  /** Source row index → display row index. */
  indexOf: ReadonlyMap<number, number>;
}>;

export type GridViewConfig = Readonly<{
  /** Number of source rows the grid can address. */
  rowCount: number;
  /** The host's query; `sort`, `filters`/`filterLogic` and `filterTree` drive the view. */
  query: DatasetQuery;
  /** Column index for a stable field id, or undefined when the field has no column. */
  columnFor(fieldId: string): number | undefined;
  /** The stored (or formula-evaluated) value at a source cell. */
  valueAt(row: number, column: number): string;
  /**
   * Whether a source row is part of the dataset at all. A bound grid has no
   * record behind an unloaded placeholder row, so those rows are excluded from
   * an active view rather than ordered as if they were empty records. Defaults
   * to every row.
   */
  hasRow?(row: number): boolean;
}>;

/**
 * Build the display view for a query, or `undefined` when the query leaves the
 * row order and membership untouched (no sort, no filter, or a filter that
 * matches everything in order) — callers treat `undefined` as the identity
 * mapping, so the common case costs nothing and needs no row table.
 */
export function buildGridView(config: GridViewConfig): GridView | undefined {
  const { rowCount, query, columnFor, valueAt, hasRow } = config;
  // A clause naming a field with no column cannot be evaluated locally; skip it.
  const sorts = (query.sort ?? []).filter((clause) => columnFor(clause.fieldId) !== undefined);
  const filters = (query.filters ?? []).filter((clause) => columnFor(clause.fieldId) !== undefined);
  const tree = query.filterTree;
  const hasFilter = filters.length > 0 || tree !== undefined;
  if (sorts.length === 0 && !hasFilter) return undefined;

  // Only the fields the query actually reads are materialised per row.
  const filterFields = new Set<string>(filters.map((filter) => filter.fieldId));
  if (tree) for (const fieldId of collectTreeFields(tree)) filterFields.add(fieldId);
  const filterColumns = new Map<string, number>();
  for (const fieldId of filterFields) {
    const column = columnFor(fieldId);
    if (column !== undefined) filterColumns.set(fieldId, column);
  }
  const matches = hasFilter
    ? filterPredicate(tree, filters, query.filterLogic, filterColumns, valueAt)
    : () => true;

  const rows: number[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    // Rows with no record behind them are placeholders, not dataset rows.
    if (hasRow !== undefined && !hasRow(row)) continue;
    if (matches(row)) rows.push(row);
  }
  if (sorts.length > 0 && rows.length > 1) {
    const sortColumns = sorts.map((sort) => columnFor(sort.fieldId) ?? -1);
    const sortValues = new Map<number, string[]>();
    for (const row of rows) sortValues.set(row, sortColumns.map((column) => (column < 0 ? "" : valueAt(row, column))));
    const valueAtCell = (row: number, index: number) => sortValues.get(row)?.[index] ?? "";
    rows.sort((left, right) => {
      for (let index = 0; index < sorts.length; index += 1) {
        const sort = sorts[index];
        const comparison = compareNullable(valueAtCell(left, index), valueAtCell(right, index), sort.direction, sort.nulls);
        if (comparison !== 0) return comparison;
      }
      return left - right;
    });
  }

  const identity = rows.length === rowCount && rows.every((row, index) => row === index);
  if (identity) return undefined;
  return { rows, indexOf: new Map(rows.map((row, index) => [row, index] as const)) };
}

/**
 * Display-space row offset table (prefix sums of the displayed row heights).
 * `offsets[n]` is the top of display row `n`; the final entry is the full
 * content height, so `offsets[bottom + 1]` spans a display range exactly.
 */
export function rowOffsetTable(count: number, heightAt: (index: number) => number): number[] {
  const offsets = [0];
  for (let index = 0; index < count; index += 1) offsets.push(offsets[index] + heightAt(index));
  return offsets;
}

/** Source row a displayed row shows; -1 when the view hides it. */
export function viewSourceRow(view: GridView | undefined, row: number): number {
  return view ? view.rows[row] ?? -1 : row;
}

/** Display row a source row appears at; -1 when the view hides it. */
export function viewDisplayRow(view: GridView | undefined, row: number): number {
  return view ? view.indexOf.get(row) ?? -1 : row;
}

/** Stored address a displayed coordinate resolves to; "" when the view hides it. */
export function viewCellKey(view: GridView | undefined, point: GridPoint): string {
  const source = viewSourceRow(view, point.row);
  return source < 0 ? "" : cellKey({ row: source, column: point.column });
}

/** Compare two cell values the way the grid's local sort always has: numeric when both parse, else locale-aware. */
export function compareGridValues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left !== "" && right !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Empty values sort first ascending and last descending unless the clause
 * names a side explicitly (`SortClause.nulls`).
 */
export function compareNullable(
  left: string,
  right: string,
  direction: "asc" | "desc",
  nulls?: "first" | "last",
): number {
  const leftEmpty = left === "";
  const rightEmpty = right === "";
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    const emptyFirst = nulls === undefined ? direction === "asc" : nulls === "first";
    return leftEmpty === emptyFirst ? -1 : 1;
  }
  const comparison = compareGridValues(left, right);
  return direction === "asc" ? comparison : -comparison;
}

/** An authoritative `filterTree`, else the flat clause list with its logic. */
function filterPredicate(
  tree: FilterNode | undefined,
  filters: readonly FilterClause[],
  logic: "and" | "or" | undefined,
  columns: ReadonlyMap<string, number>,
  valueAt: (row: number, column: number) => string,
): (row: number) => boolean {
  const rowObject = (row: number) => {
    const values: Record<string, string> = {};
    for (const [fieldId, column] of columns) values[fieldId] = valueAt(row, column);
    return values;
  };
  if (tree) {
    const predicate = buildPredicate(tree);
    return (row) => predicate(rowObject(row));
  }
  return (row) => matchClauses(rowObject(row), filters, logic ?? "and");
}

function collectTreeFields(node: FilterNode): string[] {
  if (node.type === "condition") return [node.field];
  return node.children.flatMap(collectTreeFields);
}
