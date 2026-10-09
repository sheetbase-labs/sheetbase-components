import { addressKey, columnLabel, parseAddress } from "../engine/coordinates";
import { mapFormulaReferences } from "../engine/formulas";
import { Worksheet } from "../engine/workbook";
import type { CellAddress } from "../engine/types";
import type { CellChange } from "./mutations";

export type GridPoint = Readonly<{ row: number; column: number }>;
export type GridSelection = Readonly<{ anchor: GridPoint; focus: GridPoint }>;
export type GridSnapshot = ReadonlyMap<string, string>;

/**
 * Resolves a grid coordinate to its stored address. Defaults to the address of
 * the coordinate itself; a locally sorted/filtered view passes a resolver that
 * maps each displayed row to the source row it shows, so bulk operations still
 * read and write the records behind the rows the user selected.
 */
export type CellKeyResolver = (point: GridPoint) => string;

export type FormulaSuggestion = Readonly<{
  label: string;
  detail: string;
  replacement: string;
  tokenStart: number;
  kind: "function" | "field" | "region";
  previewRange?: string;
}>;

export type FormulaRegion = Readonly<{ label: string; reference?: string; detail?: string }>;

const formulaFunctions = [
  { label: "SUM", detail: "Add the values in a range" },
  { label: "AVERAGE", detail: "Return the mean of a range" },
  { label: "MIN", detail: "Return the smallest value" },
  { label: "MAX", detail: "Return the largest value" },
  { label: "COUNT", detail: "Count numeric values" },
  { label: "COUNTA", detail: "Count non-empty values" },
  { label: "IF", detail: "Choose a result from a condition" },
  { label: "XLOOKUP", detail: "Find a value in another range" },
  { label: "MATCH", detail: "Return a value's position in a range" },
  { label: "ROUND", detail: "Round a number to a precision" },
  { label: "ABS", detail: "Return the absolute value" },
  { label: "SQRT", detail: "Return the square root" },
  { label: "AND", detail: "True when every argument is true" },
  { label: "OR", detail: "True when any argument is true" },
  { label: "NOT", detail: "Reverse a boolean value" },
  { label: "DATE", detail: "Create a date from year, month and day" },
  { label: "YEAR", detail: "Return the year from a date" },
  { label: "MONTH", detail: "Return the month from a date" },
  { label: "DAY", detail: "Return the day from a date" },
  { label: "TODAY", detail: "Return today's UTC date" },
  { label: "SEQUENCE", detail: "Spill a numeric sequence into cells" },
] as const;

export function cellKey(point: GridPoint): string {
  return addressKey(point);
}

export function normaliseSelection(selection: GridSelection) {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function moveSelection(
  selection: GridSelection,
  delta: GridPoint,
  rowCount: number,
  columnCount: number,
  extend = false,
): GridSelection {
  const focus = {
    row: Math.max(0, Math.min(rowCount - 1, selection.focus.row + delta.row)),
    column: Math.max(0, Math.min(columnCount - 1, selection.focus.column + delta.column)),
  };
  return { anchor: extend ? selection.anchor : focus, focus };
}

/**
 * Excel Ctrl+Arrow semantics: when the next cell in `delta`'s direction is
 * populated, land on the far edge of that contiguous populated block; when it
 * is empty, skip the gap and land on the next populated cell — or the grid
 * edge when nothing remains. `hasValue` decides whether an address counts as
 * populated (raw input or a spill child).
 */
export function edgeOfData(
  hasValue: (address: string) => boolean,
  from: GridPoint,
  delta: GridPoint,
  rowCount: number,
  columnCount: number,
  keyFor: CellKeyResolver = cellKey,
): GridPoint {
  const stepRow = Math.sign(delta.row);
  const stepColumn = Math.sign(delta.column);
  const inside = (row: number, column: number) => row >= 0 && row < rowCount && column >= 0 && column < columnCount;
  let { row, column } = from;
  let nextRow = row + stepRow;
  let nextColumn = column + stepColumn;
  if (!inside(nextRow, nextColumn)) return from;
  if (hasValue(keyFor({ row: nextRow, column: nextColumn }))) {
    // Populated neighbour: run to the far edge of the block.
    while (inside(nextRow, nextColumn) && hasValue(keyFor({ row: nextRow, column: nextColumn }))) {
      row = nextRow;
      column = nextColumn;
      nextRow += stepRow;
      nextColumn += stepColumn;
    }
    return { row, column };
  }
  // Empty neighbour: cross the gap and land on the first populated cell.
  while (inside(nextRow, nextColumn) && !hasValue(keyFor({ row: nextRow, column: nextColumn }))) {
    row = nextRow;
    column = nextColumn;
    nextRow += stepRow;
    nextColumn += stepColumn;
  }
  return inside(nextRow, nextColumn) ? { row: nextRow, column: nextColumn } : { row, column };
}

/** Bounding box of every populated cell; undefined for an empty sheet. */
export function usedRangeBounds(data: GridSnapshot): { top: number; left: number; bottom: number; right: number } | undefined {
  let top = Infinity;
  let left = Infinity;
  let bottom = -1;
  let right = -1;
  for (const [address, value] of data) {
    if (value === "") continue;
    try {
      const point = parseAddress(address);
      if (point.row < 0 || point.column < 0) continue;
      top = Math.min(top, point.row);
      left = Math.min(left, point.column);
      bottom = Math.max(bottom, point.row);
      right = Math.max(right, point.column);
    } catch { /* Ignore non-cell keys. */ }
  }
  return bottom >= top ? { top, left, bottom, right } : undefined;
}

export function selectionToTsv(data: GridSnapshot, selection: GridSelection, keyFor: CellKeyResolver = cellKey): string {
  const range = normaliseSelection(selection);
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const values: string[] = [];
    for (let column = range.left; column <= range.right; column++) {
      values.push(data.get(keyFor({ row, column })) ?? "");
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

export function selectionAddresses(selection: GridSelection, keyFor: CellKeyResolver = cellKey): string[] {
  const range = normaliseSelection(selection);
  const addresses: string[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) {
      const address = keyFor({ row, column });
      if (address !== "") addresses.push(address);
    }
  }
  return addresses;
}

export function parseTsv(tsv: string): readonly (readonly string[])[] {
  return tsv.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((row) => row.split("\t"));
}

/**
 * Walks each in-bounds TSV cell, resolving its address through `keyFor`. Shared
 * by the applying paste and the pre-commit target set so both agree on the
 * exact cells a paste targets.
 */
function eachTsvTarget(
  start: GridPoint,
  rows: readonly (readonly string[])[],
  rowCount: number,
  columnCount: number,
  keyFor: CellKeyResolver,
  visit: (point: GridPoint, address: string, after: string | undefined) => void,
): void {
  rows.forEach((values, rowOffset) => {
    values.forEach((value, columnOffset) => {
      const point = { row: start.row + rowOffset, column: start.column + columnOffset };
      if (point.row >= rowCount || point.column >= columnCount) return;
      const address = keyFor(point);
      if (address === "") return;
      visit(point, address, value === "" ? undefined : value);
    });
  });
}

/**
 * Every cell a paste would change — including cells the grid will not write
 * because they are not editable. Handed to the pre-commit gate so a host can
 * reject the whole operation instead of letting the editable subset land.
 */
export function pasteTargetChanges(
  data: GridSnapshot,
  start: GridPoint,
  rows: readonly (readonly string[])[],
  rowCount: number,
  columnCount: number,
  keyFor: CellKeyResolver = cellKey,
): CellChange[] {
  const targets: CellChange[] = [];
  eachTsvTarget(start, rows, rowCount, columnCount, keyFor, (_point, address, after) => {
    const before = data.get(address);
    if (before !== after) targets.push({ address, before, after });
  });
  return targets;
}

export function applyTsvRows(
  data: GridSnapshot,
  start: GridPoint,
  rows: readonly (readonly string[])[],
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
  keyFor: CellKeyResolver = cellKey,
): { data: Map<string, string>; selection: GridSelection } {
  const next = new Map(data);
  let bottom = start.row;
  let right = start.column;
  eachTsvTarget(start, rows, rowCount, columnCount, keyFor, (point, address, after) => {
    bottom = Math.max(bottom, point.row);
    right = Math.max(right, point.column);
    if (!canEdit(point)) return;
    if (after === undefined) next.delete(address); else next.set(address, after);
  });
  return { data: next, selection: { anchor: start, focus: { row: bottom, column: right } } };
}

export function pasteTsv(
  data: GridSnapshot,
  start: GridPoint,
  tsv: string,
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
  keyFor: CellKeyResolver = cellKey,
): { data: Map<string, string>; selection: GridSelection } {
  return applyTsvRows(data, start, parseTsv(tsv), rowCount, columnCount, canEdit, keyFor);
}

export function clearSelection(
  data: GridSnapshot,
  selection: GridSelection,
  canEdit: (point: GridPoint) => boolean = () => true,
  keyFor: CellKeyResolver = cellKey,
): Map<string, string> {
  const next = new Map(data);
  const range = normaliseSelection(selection);
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) {
      const point = { row, column };
      if (!canEdit(point)) continue;
      const address = keyFor(point);
      if (address !== "") next.delete(address);
    }
  }
  return next;
}

/**
 * The intended target set of a clear: every populated cell in the selection.
 * Clearing an already-empty cell changes nothing, so it is not a target.
 */
export function clearRangeTargets(data: GridSnapshot, selection: GridSelection, keyFor: CellKeyResolver = cellKey): CellChange[] {
  const targets: CellChange[] = [];
  const range = normaliseSelection(selection);
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) {
      const address = keyFor({ row, column });
      if (address === "") continue;
      const before = data.get(address);
      if (before !== undefined && before !== "") targets.push({ address, before, after: undefined });
    }
  }
  return targets;
}

/**
 * Move a rectangular block of values to a new top-left origin (Excel's
 * drag-the-border move). Values are snapshot first so overlapping source and
 * destination stay consistent; uneditable source cells stay behind and
 * uneditable targets are skipped. Returns undefined for a no-op drop.
 *
 * `intended` mirrors the whole operation as if every cell were editable —
 * source cells that would be emptied and destinations that would receive a
 * value, whether or not the grid will actually write them — so the pre-commit
 * gate can reject a move that only partially applies.
 */
export function moveRange(
  data: GridSnapshot,
  source: GridSelection,
  target: GridPoint,
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
  keyFor: CellKeyResolver = cellKey,
): { data: Map<string, string>; selection: GridSelection; intended: CellChange[] } | undefined {
  const range = normaliseSelection(source);
  const height = range.bottom - range.top + 1;
  const width = range.right - range.left + 1;
  const top = Math.max(0, Math.min(rowCount - height, target.row));
  const left = Math.max(0, Math.min(columnCount - width, target.column));
  if (top === range.top && left === range.left) return undefined;
  const moved: { point: GridPoint; destination: GridPoint; value: string; address: string; destinationAddress: string }[] = [];
  const intended: CellChange[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) {
      const point = { row, column };
      const address = keyFor(point);
      if (address === "") continue;
      const value = data.get(address);
      if (value === undefined) continue;
      const destination = { row: point.row + top - range.top, column: point.column + left - range.left };
      const destinationAddress = keyFor(destination);
      if (destinationAddress === "") continue;
      moved.push({ point, destination, value, address, destinationAddress });
      intended.push({ address, before: value, after: undefined });
      intended.push({ address: destinationAddress, before: data.get(destinationAddress), after: value });
    }
  }
  const next = new Map(data);
  for (const entry of moved) {
    if (!canEdit(entry.point)) continue;
    next.delete(entry.address);
  }
  for (const entry of moved) {
    if (!canEdit(entry.point) || !canEdit(entry.destination)) continue;
    next.set(entry.destinationAddress, entry.value);
  }
  return {
    data: next,
    selection: {
      anchor: { row: top, column: left },
      focus: { row: top + height - 1, column: left + width - 1 },
    },
    intended,
  };
}

export type SelectionAggregates = Readonly<{
  /** Non-empty cells in the selection. */
  count: number;
  /** Cells whose (evaluated) value parses as a finite number. */
  numeric: number;
  sum: number;
  min: number;
  max: number;
}>;

/** Status-bar aggregates over the populated cells of a selection. */
export function selectionAggregates(
  data: GridSnapshot,
  selection: GridSelection,
  evaluate?: (point: GridPoint) => string,
  keyFor: CellKeyResolver = cellKey,
): SelectionAggregates {
  const range = normaliseSelection(selection);
  const area = (range.bottom - range.top + 1) * (range.right - range.left + 1);
  let count = 0;
  let numeric = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const add = (point: GridPoint, raw: string | undefined) => {
    if (raw === undefined) return;
    const text = raw.startsWith("=") && evaluate ? evaluate(point) : raw;
    if (text === "") return;
    count += 1;
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    numeric += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  };
  if (keyFor === cellKey && data.size <= area) {
    // Fewer populated cells than selected cells: scan the data and filter.
    for (const [address, raw] of data) {
      let point: CellAddress;
      try { point = parseAddress(address); } catch { continue; }
      if (point.row < range.top || point.row > range.bottom || point.column < range.left || point.column > range.right) continue;
      add(point, raw);
    }
  } else {
    // Small selection over a large sheet, or a view: probe each cell through
    // its resolver (a view's displayed rows are not a contiguous source range).
    for (let row = range.top; row <= range.bottom; row++) {
      for (let column = range.left; column <= range.right; column++) {
        const address = keyFor({ row, column });
        if (address === "") continue;
        add({ row, column }, data.get(address));
      }
    }
  }
  return { count, numeric, sum, min: numeric ? min : 0, max: numeric ? max : 0 };
}

export function shiftFormulaReferences(formula: string, rowDelta: number, columnDelta: number): string {
  return mapFormulaReferences(formula, (reference) => {
    const bang = reference.lastIndexOf("!");
    const sheet = bang >= 0 ? reference.slice(0, bang + 1) : "";
    const cell = bang >= 0 ? reference.slice(bang + 1) : reference;
    const match = /^(\$?)([A-Z]+)(\$?)([1-9]\d*)$/i.exec(cell);
    if (!match) return reference;
    const [, absoluteColumn, columnName, absoluteRow, rowName] = match;
    const source = parseAddress(`${columnName}${rowName}`);
    const row = source.row + (absoluteRow ? 0 : rowDelta);
    const column = source.column + (absoluteColumn ? 0 : columnDelta);
    if (row < 0 || column < 0) return `${sheet}#REF!`;
    const shifted = addressKey({ row, column });
    const parts = /^([A-Z]+)(\d+)$/.exec(shifted);
    if (!parts) return reference;
    return `${sheet}${absoluteColumn}${parts[1]}${absoluteRow}${parts[2]}`;
  });
}

export function fillSelection(
  data: GridSnapshot,
  sourceSelection: GridSelection,
  target: GridPoint,
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
  keyFor: CellKeyResolver = cellKey,
): { data: Map<string, string>; selection: GridSelection; intended: CellChange[] } {
  const source = normaliseSelection(sourceSelection);
  const destination = {
    top: Math.max(0, Math.min(source.top, target.row)),
    bottom: Math.min(rowCount - 1, Math.max(source.bottom, target.row)),
    left: Math.max(0, Math.min(source.left, target.column)),
    right: Math.min(columnCount - 1, Math.max(source.right, target.column)),
  };
  const sourceHeight = source.bottom - source.top + 1;
  const sourceWidth = source.right - source.left + 1;
  const series = sourceWidth === 1 && sourceHeight >= 2
    ? inferSeries(data.get(keyFor({ row: source.top, column: source.left })) ?? "", data.get(keyFor({ row: source.top + 1, column: source.left })) ?? "")
    : undefined;
  const next = new Map(data);
  const intended: CellChange[] = [];
  for (let row = destination.top; row <= destination.bottom; row++) {
    for (let column = destination.left; column <= destination.right; column++) {
      if (row >= source.top && row <= source.bottom && column >= source.left && column <= source.right) continue;
      const sourceRow = source.top + ((row - source.top) % sourceHeight + sourceHeight) % sourceHeight;
      const sourceColumn = source.left + ((column - source.left) % sourceWidth + sourceWidth) % sourceWidth;
      const value = data.get(keyFor({ row: sourceRow, column: sourceColumn })) ?? "";
      const seriesValue = series && column === source.left && row > source.bottom
        ? series(row - source.top)
        : undefined;
      const adjusted = seriesValue ?? (value.startsWith("=")
        ? shiftFormulaReferences(value, row - sourceRow, column - sourceColumn)
        : value);
      const after = adjusted === "" ? undefined : adjusted;
      const point = { row, column };
      const address = keyFor(point);
      if (address === "") continue;
      const before = data.get(address);
      if (before !== after) intended.push({ address, before, after });
      if (!canEdit(point)) continue;
      if (after === undefined) next.delete(address); else next.set(address, after);
    }
  }
  return {
    data: next,
    selection: {
      anchor: { row: destination.top, column: destination.left },
      focus: { row: destination.bottom, column: destination.right },
    },
    intended,
  };
}

function inferSeries(first: string, second: string): ((offset: number) => string) | undefined {
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  if (first.trim() !== "" && second.trim() !== "" && Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    const step = secondNumber - firstNumber;
    return (offset) => String(firstNumber + step * offset);
  }
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDate.test(first) && isoDate.test(second)) {
    const start = Date.parse(`${first}T00:00:00Z`);
    const step = Date.parse(`${second}T00:00:00Z`) - start;
    return (offset) => new Date(start + step * offset).toISOString().slice(0, 10);
  }
  return undefined;
}

export function buildWorksheet(data: GridSnapshot): Worksheet {
  const worksheet = new Worksheet();
  for (const [address, input] of data) worksheet.setInput(address, input);
  return worksheet;
}

export function displayValue(worksheet: Worksheet, point: GridPoint): string {
  const address = cellKey(point);
  try {
    const value = worksheet.value(address);
    if (value === null) return "";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Circular")) return "#CYCLE!";
    if (error instanceof Error && error.message.startsWith("#")) return error.message;
    return "#ERROR!";
  }
}

export function formulaErrorMessage(value: string): string | undefined {
  const messages: Record<string, string> = {
    "#SPILL!": "#SPILL! — The result cannot expand because a destination cell is occupied. Clear the highlighted destination range.",
    "#REF!": "#REF! — This formula contains an invalid cell reference, usually after a row, column or sheet was removed.",
    "#DIV/0!": "#DIV/0! — This formula divides by zero or an empty cell. Check the divisor or guard it with IF.",
    "#CYCLE!": "#CYCLE! — This formula refers back to itself through one or more cells.",
    "#ERROR!": "#ERROR! — This formula could not be calculated. Check its syntax and arguments.",
    "#NAME?": "#NAME? — This function or name is not recognised. Check its spelling or choose a suggestion.",
    "#N/A": "#N/A — No matching value was found. Check the lookup value and lookup range.",
  };
  return messages[value];
}

export type CellDataType = "text" | "number" | "date" | "datetime" | "boolean" | "relationship";

export function validateTypedCell(value: string, dataType: CellDataType = "text", required = false, options?: readonly string[]): string | undefined {
  if (value.startsWith("=")) return undefined;
  if (required && value.trim() === "") return "A value is required.";
  if (value.trim() === "") return undefined;
  if (dataType === "number" && !Number.isFinite(Number(value))) return "Enter a valid number.";
  if (dataType === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return "Enter a date as YYYY-MM-DD.";
  if (dataType === "datetime") {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(value);
    if (!match || Number.isNaN(Date.parse(`${match[1]}T${match[2]}${match[3] ?? ""}`))) return "Enter a datetime as YYYY-MM-DD HH:MM.";
  }
  if (dataType === "boolean" && !/^(true|false)$/i.test(value)) return "Enter true or false.";
  if (options?.length) {
    const allowed = new Set(options);
    if (!value.split(",").map((entry) => entry.trim()).every((entry) => allowed.has(entry))) return `Choose one of: ${options.join(", ")}.`;
  }
  return undefined;
}

export function renameSheetReferences(input: string, previousLabel: string, nextLabel: string): string {
  if (!input.startsWith("=")) return input;
  const escaped = previousLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = /^[A-Za-z_][A-Za-z0-9_]*$/.test(nextLabel) ? nextLabel : `'${nextLabel.replace(/'/g, "''")}'`;
  return input
    .replace(new RegExp(`'${escaped.replace(/'/g, "''")}'!`, "g"), `${next}!`)
    .replace(new RegExp(`\\b${escaped}!`, "g"), `${next}!`);
}

export type GridStructureChange = Readonly<{
  axis: "row" | "column";
  index: number;
  count: number;
  kind: "insert" | "delete";
}>;

export function changeGridStructure(data: GridSnapshot, change: GridStructureChange): Map<string, string> {
  const next = new Map<string, string>();
  for (const [address, input] of data) {
    let point: CellAddress;
    try { point = parseAddress(address); } catch { next.set(address, input); continue; }
    const coordinate = change.axis === "row" ? point.row : point.column;
    if (change.kind === "delete" && coordinate >= change.index && coordinate < change.index + change.count) continue;
    const shift = change.kind === "insert"
      ? (coordinate >= change.index ? change.count : 0)
      : (coordinate >= change.index + change.count ? -change.count : 0);
    const moved = change.axis === "row" ? { ...point, row: point.row + shift } : { ...point, column: point.column + shift };
    next.set(addressKey(moved), adjustFormulaForStructure(input, change));
  }
  return next;
}

export function sortGridRows(data: GridSnapshot, column: number, direction: "asc" | "desc"): Map<string, string> {
  const rows = new Map<number, Map<number, string>>();
  for (const [address, value] of data) {
    let point: CellAddress;
    try { point = parseAddress(address); } catch { continue; }
    const row = rows.get(point.row) ?? new Map<number, string>();
    row.set(point.column, value);
    rows.set(point.row, row);
  }
  const sourceRows = [...rows.entries()].sort(([leftRow, left], [rightRow, right]) => {
    const leftValue = left.get(column) ?? "";
    const rightValue = right.get(column) ?? "";
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const comparison = leftValue !== "" && rightValue !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
    return (direction === "asc" ? comparison : -comparison) || leftRow - rightRow;
  });
  const output = new Map<string, string>();
  sourceRows.forEach(([, row], targetRow) => {
    row.forEach((value, targetColumn) => {
      output.set(cellKey({ row: targetRow, column: targetColumn }), value);
    });
  });
  return output;
}

function adjustFormulaForStructure(input: string, change: GridStructureChange): string {
  if (!input.startsWith("=")) return input;
  // Tokenize rather than regex: only `reference` tokens are rewritten, so
  // function names (LOG10) and string literals ("see A1") stay intact.
  return mapFormulaReferences(input, (reference) => {
    const bang = reference.lastIndexOf("!");
    const sheet = bang >= 0 ? reference.slice(0, bang + 1) : "";
    const cell = bang >= 0 ? reference.slice(bang + 1) : reference;
    const match = /^(\$?)([A-Z]+)(\$?)([1-9]\d*)$/i.exec(cell);
    if (!match) return reference;
    const [, absoluteColumn, columnName, absoluteRow, rowName] = match;
    const point = parseAddress(`${columnName}${rowName}`);
    const coordinate = change.axis === "row" ? point.row : point.column;
    if (change.kind === "delete" && coordinate >= change.index && coordinate < change.index + change.count) return `${sheet}#REF!`;
    const shift = change.kind === "insert"
      ? (coordinate >= change.index ? change.count : 0)
      : (coordinate >= change.index + change.count ? -change.count : 0);
    if (shift === 0) return reference;
    const moved = change.axis === "row" ? { ...point, row: point.row + shift } : { ...point, column: point.column + shift };
    const address = /^([A-Z]+)(\d+)$/.exec(addressKey(moved));
    if (!address) return reference;
    return `${sheet}${absoluteColumn}${address[1]}${absoluteRow}${address[2]}`;
  });
}

/** Case-insensitive replace-all preserving unmatched text (grid find is case-insensitive). */
export function replaceAllText(value: string, query: string, replacement: string): Readonly<{ text: string; count: number }> {
  if (!query) return { text: value, count: 0 };
  const lower = value.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let text = "";
  let cursor = 0;
  let count = 0;
  for (;;) {
    const index = lower.indexOf(needle, cursor);
    if (index < 0) break;
    text += value.slice(cursor, index) + replacement;
    cursor = index + needle.length;
    count += 1;
  }
  return { text: text + value.slice(cursor), count };
}

export function selectionLabel(selection: GridSelection): string {
  const range = normaliseSelection(selection);
  const start = `${columnLabel(range.left)}${range.top + 1}`;
  const end = `${columnLabel(range.right)}${range.bottom + 1}`;
  return start === end ? start : `${start}:${end}`;
}

/** Return the populated extent of one column, independently of autocomplete ranking. */
export function populatedColumnSelection(
  data: GridSnapshot,
  column: number,
  excluded?: GridPoint,
): GridSelection | null {
  const rows: number[] = [];
  for (const [address, value] of data) {
    if (value === "") continue;
    try {
      const point = parseAddress(address);
      if (point.column !== column || (excluded && point.row === excluded.row && point.column === excluded.column)) continue;
      rows.push(point.row);
    } catch { /* Ignore non-cell keys. */ }
  }
  if (rows.length === 0) return null;
  return {
    anchor: { row: Math.min(...rows), column },
    focus: { row: Math.max(...rows), column },
  };
}

export function addressToPoint(address: string): CellAddress {
  return parseAddress(address);
}

export function formulaSuggestions(
  input: string,
  activeRow: number,
  fields: readonly { label: string; column: number }[],
  regions: readonly FormulaRegion[] = [],
): readonly FormulaSuggestion[] {
  if (!input.startsWith("=")) return [];
  const openAggregate = /=\s*(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA)\($/i.exec(input);
  if (openAggregate) return regions.slice(0, 1).map((region) => ({
    label: region.reference ?? region.label,
    detail: region.detail ?? "Populated region",
    replacement: `${region.reference ?? region.label})`,
    previewRange: region.label,
    tokenStart: input.length,
    kind: "region",
  }));
  const token = /([A-Z_][A-Z0-9_]*)$/i.exec(input);
  if (!token) return [];
  const query = token[1].toLowerCase();
  const tokenStart = token.index;
  const functions: FormulaSuggestion[] = [];
  for (const item of formulaFunctions) {
    if (!item.label.toLowerCase().startsWith(query)) continue;
    functions.push({ label: item.label, detail: item.detail, replacement: `${item.label}(`, tokenStart, kind: "function" });
  }
  const fieldSuggestions: FormulaSuggestion[] = fields
    .filter((field) => field.label.toLowerCase().includes(query))
    .slice(0, 8)
    .map((field) => ({
      label: field.label,
      detail: `${columnLabel(field.column)}${activeRow + 1} · dataset field`,
      replacement: `${columnLabel(field.column)}${activeRow + 1}`,
      tokenStart,
      kind: "field",
    }));
  const aggregate = /^(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA)$/i.exec(token[1]);
  const regionSuggestions: FormulaSuggestion[] = aggregate ? regions.slice(0, 1).map((region) => ({
    label: `${aggregate[1].toUpperCase()}(${region.reference ?? region.label})`,
    detail: region.detail ?? "Populated region",
    replacement: `${aggregate[1].toUpperCase()}(${region.reference ?? region.label})`,
    previewRange: region.label,
    tokenStart,
    kind: "region",
  })) : [];
  if (regionSuggestions.length > 0) return regionSuggestions;
  return [...fieldSuggestions, ...functions].slice(0, 8);
}

export function applyFormulaSuggestion(input: string, suggestion: FormulaSuggestion): string {
  return input.slice(0, suggestion.tokenStart) + suggestion.replacement;
}

export type FormulaReferenceSelection = Readonly<{
  anchor: GridPoint;
  focus: GridPoint;
  tokenStart: number;
}>;

export function formulaReferenceLabel(selection: FormulaReferenceSelection): string {
  const start = cellKey(selection.anchor);
  const end = cellKey(selection.focus);
  return start === end ? start : `${start}:${end}`;
}

export function applyFormulaReference(input: string, selection: FormulaReferenceSelection): string {
  return input.slice(0, selection.tokenStart) + formulaReferenceLabel(selection);
}

export function completeFormula(input: string): string {
  if (!input.startsWith("=")) return input;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"' && input[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (character === "(") depth++;
    if (character === ")") depth = Math.max(0, depth - 1);
  }
  return input + ")".repeat(depth);
}

/** Cycle the last cell/range reference through Excel-style absolute forms. */
export function cycleAbsoluteReference(input: string): string {
  const matches = [...input.matchAll(/(\$?)([A-Z]+)(\$?)([1-9]\d*)/gi)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return input;
  const [, absoluteColumn, column, absoluteRow, row] = match;
  const replacement = !absoluteColumn && !absoluteRow
    ? `$${column.toUpperCase()}$${row}`
    : absoluteColumn && absoluteRow
      ? `${column.toUpperCase()}$${row}`
      : !absoluteColumn && absoluteRow
        ? `$${column.toUpperCase()}${row}`
        : `${column.toUpperCase()}${row}`;
  return input.slice(0, match.index) + replacement + input.slice(match.index + match[0].length);
}

export function moveFormulaReference(
  current: FormulaReferenceSelection | null,
  editing: GridPoint,
  delta: GridPoint,
  extend: boolean,
  rowCount: number,
  columnCount: number,
  tokenStart: number,
): FormulaReferenceSelection {
  const origin = current?.focus ?? editing;
  const focus = {
    row: Math.max(0, Math.min(rowCount - 1, origin.row + delta.row)),
    column: Math.max(0, Math.min(columnCount - 1, origin.column + delta.column)),
  };
  return {
    anchor: current && extend ? current.anchor : focus,
    focus,
    tokenStart: current?.tokenStart ?? tokenStart,
  };
}

export function formulaReferenceRanges(input: string): readonly GridSelection[] {
  if (!input.startsWith("=")) return [];
  const ranges: GridSelection[] = [];
  const references = /(?:^|[^A-Z0-9_!])((?:\$?[A-Z]+\$?\d+))(?::((?:\$?[A-Z]+\$?\d+)))?/gi;
  for (const match of input.matchAll(references)) {
    try {
      const anchor = parseAddress(match[1].replaceAll("$", ""));
      const focus = parseAddress((match[2] ?? match[1]).replaceAll("$", ""));
      ranges.push({ anchor, focus });
    } catch { /* Ignore incomplete references while editing. */ }
  }
  return ranges;
}
