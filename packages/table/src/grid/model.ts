import { addressKey, columnLabel, parseAddress } from "../engine/coordinates";
import { mapFormulaReferences } from "../engine/formulas";
import { Worksheet } from "../engine/workbook";
import type { CellAddress } from "../engine/types";

export type GridPoint = Readonly<{ row: number; column: number }>;
export type GridSelection = Readonly<{ anchor: GridPoint; focus: GridPoint }>;
export type GridSnapshot = ReadonlyMap<string, string>;
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

export function selectionToTsv(data: GridSnapshot, selection: GridSelection): string {
  const range = normaliseSelection(selection);
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const values: string[] = [];
    for (let column = range.left; column <= range.right; column++) {
      values.push(data.get(cellKey({ row, column })) ?? "");
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

export function selectionAddresses(selection: GridSelection): string[] {
  const range = normaliseSelection(selection);
  const addresses: string[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) addresses.push(cellKey({ row, column }));
  }
  return addresses;
}

export function parseTsv(tsv: string): readonly (readonly string[])[] {
  return tsv.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((row) => row.split("\t"));
}

export function applyTsvRows(
  data: GridSnapshot,
  start: GridPoint,
  rows: readonly (readonly string[])[],
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
): { data: Map<string, string>; selection: GridSelection } {
  const next = new Map(data);
  let bottom = start.row;
  let right = start.column;
  rows.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
    const row = start.row + rowOffset;
    const column = start.column + columnOffset;
    if (row >= rowCount || column >= columnCount) return;
    if (!canEdit({ row, column })) return;
    const key = cellKey({ row, column });
    if (value === "") next.delete(key); else next.set(key, value);
    bottom = Math.max(bottom, row);
    right = Math.max(right, column);
  }));
  return { data: next, selection: { anchor: start, focus: { row: bottom, column: right } } };
}

export function pasteTsv(
  data: GridSnapshot,
  start: GridPoint,
  tsv: string,
  rowCount: number,
  columnCount: number,
  canEdit: (point: GridPoint) => boolean = () => true,
): { data: Map<string, string>; selection: GridSelection } {
  return applyTsvRows(data, start, parseTsv(tsv), rowCount, columnCount, canEdit);
}

export function clearSelection(
  data: GridSnapshot,
  selection: GridSelection,
  canEdit: (point: GridPoint) => boolean = () => true,
): Map<string, string> {
  const next = new Map(data);
  const range = normaliseSelection(selection);
  for (let row = range.top; row <= range.bottom; row++) {
    for (let column = range.left; column <= range.right; column++) {
      if (canEdit({ row, column })) next.delete(cellKey({ row, column }));
    }
  }
  return next;
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
    const parts = /^([A-Z]+)(\d+)$/.exec(shifted)!;
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
): { data: Map<string, string>; selection: GridSelection } {
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
    ? inferSeries(data.get(cellKey({ row: source.top, column: source.left })) ?? "", data.get(cellKey({ row: source.top + 1, column: source.left })) ?? "")
    : undefined;
  const next = new Map(data);
  for (let row = destination.top; row <= destination.bottom; row++) {
    for (let column = destination.left; column <= destination.right; column++) {
      if (row >= source.top && row <= source.bottom && column >= source.left && column <= source.right) continue;
      if (!canEdit({ row, column })) continue;
      const sourceRow = source.top + ((row - source.top) % sourceHeight + sourceHeight) % sourceHeight;
      const sourceColumn = source.left + ((column - source.left) % sourceWidth + sourceWidth) % sourceWidth;
      const value = data.get(cellKey({ row: sourceRow, column: sourceColumn })) ?? "";
      const seriesValue = series && column === source.left && row > source.bottom
        ? series(row - source.top)
        : undefined;
      const adjusted = seriesValue ?? (value.startsWith("=")
        ? shiftFormulaReferences(value, row - sourceRow, column - sourceColumn)
        : value);
      const key = cellKey({ row, column });
      if (adjusted === "") next.delete(key); else next.set(key, adjusted);
    }
  }
  return {
    data: next,
    selection: {
      anchor: { row: destination.top, column: destination.left },
      focus: { row: destination.bottom, column: destination.right },
    },
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

export type CellDataType = "text" | "number" | "date" | "boolean" | "relationship";

export function validateTypedCell(value: string, dataType: CellDataType = "text", required = false, options?: readonly string[]): string | undefined {
  if (value.startsWith("=")) return undefined;
  if (required && value.trim() === "") return "A value is required.";
  if (value.trim() === "") return undefined;
  if (dataType === "number" && !Number.isFinite(Number(value))) return "Enter a valid number.";
  if (dataType === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return "Enter a date as YYYY-MM-DD.";
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
  sourceRows.forEach(([, row], targetRow) => row.forEach((value, targetColumn) => output.set(cellKey({ row: targetRow, column: targetColumn }), value)));
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
    const address = /^([A-Z]+)(\d+)$/.exec(addressKey(moved))!;
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
