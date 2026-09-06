import type { CellAddress, CellRange } from "./types";

export function columnLabel(column: number): string {
  if (!Number.isInteger(column) || column < 0) throw new RangeError("column must be >= 0");
  let value = column + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function parseAddress(value: string): CellAddress {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid cell address: ${value}`);
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column: column - 1, row: Number(match[2]) - 1 };
}

export function addressKey(address: CellAddress): string {
  return `${columnLabel(address.column)}${address.row + 1}`;
}

export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      column: Math.min(range.start.column, range.end.column),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      column: Math.max(range.start.column, range.end.column),
    },
  };
}
