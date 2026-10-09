import type { FieldDataType } from "@sheetbase-labs/sheetbase-shared";

export type {
  FilterClause,
  FilterOperator,
  FilterValueInput,
} from "@sheetbase-labs/sheetbase-shared";
export {
  buildFilterValue,
  ensureOperator,
  filterValueSummary,
  operatorLabel,
  operatorsForField,
} from "@sheetbase-labs/sheetbase-shared";

/** Minimal structural field description accepted by the filter and column controls. */
export type TableControlsField = Readonly<{
  id: string;
  label: string;
  dataType?: FieldDataType;
  options?: readonly string[];
}>;
