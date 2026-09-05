import { operatorShortLabel, operatorsForField, type FilterOperator } from "sheetbase-shared";
import type { ColumnKind } from "./types";

/** Operators for the explorer filter popover, aligned with the shared field contract. */
export function filterOperators(kind: ColumnKind): Array<[FilterOperator, string]> {
  const dataType = kind === "string" ? "text" : kind;
  return operatorsForField({ dataType }).map((op) => [op, operatorShortLabel(op)]);
}
