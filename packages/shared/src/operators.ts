import type { FieldDataType } from "./fields";

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "between"
  | "isNull"
  | "notNull"
  | "withinLastDays";

const CANONICAL = new Set<string>([
  "eq", "neq", "gt", "gte", "lt", "lte",
  "contains", "startsWith", "endsWith", "in", "between",
  "isNull", "notNull", "withinLastDays",
]);

const ALIASES: Readonly<Record<string, FilterOperator>> = {
  isEmpty: "isNull",
  isNotEmpty: "notNull",
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  greaterThanOrEqual: "gte",
  lessThan: "lt",
  lessThanOrEqual: "lte",
  isBlank: "isNull",
  isNotBlank: "notNull",
};

/** Map a stored or parsed operator onto the canonical set. Unknown names return undefined. */
export function normaliseOperator(raw: string): FilterOperator | undefined {
  if (CANONICAL.has(raw)) return raw as FilterOperator;
  return ALIASES[raw];
}

const textOperators: readonly FilterOperator[] = ["eq", "neq", "contains", "startsWith", "endsWith", "in", "isNull", "notNull"];
const numberOperators: readonly FilterOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isNull", "notNull"];
const dateOperators: readonly FilterOperator[] = ["eq", "gt", "lt", "between", "withinLastDays", "isNull", "notNull"];
const booleanOperators: readonly FilterOperator[] = ["eq", "isNull", "notNull"];
const optionOperators: readonly FilterOperator[] = ["eq", "neq", "in", "isNull", "notNull"];

export function operatorsForField(field: { dataType?: FieldDataType; options?: readonly string[] }): readonly FilterOperator[] {
  if (field.options?.length || field.dataType === "relationship") return optionOperators;
  if (field.dataType === "number") return numberOperators;
  if (field.dataType === "date" || field.dataType === "datetime") return dateOperators;
  if (field.dataType === "boolean") return booleanOperators;
  return textOperators;
}

const operatorLabels: Readonly<Record<FilterOperator, string>> = {
  eq: "Equals",
  neq: "Does not equal",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  contains: "Contains",
  startsWith: "Starts with",
  endsWith: "Ends with",
  in: "Is any of",
  between: "Between",
  isNull: "Is empty",
  notNull: "Is not empty",
  withinLastDays: "Within the last",
};

const dateOperatorLabels: Readonly<Partial<Record<FilterOperator, string>>> = {
  gt: "After",
  gte: "On or after",
  lt: "Before",
  lte: "On or before",
};

const shortLabels: Readonly<Record<FilterOperator, string>> = {
  eq: "is",
  neq: "isn't",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  in: "is one of",
  between: "is between",
  isNull: "is empty",
  notNull: "is not empty",
  withinLastDays: "within the last",
};

export function operatorLabel(operator: FilterOperator, field?: { dataType?: FieldDataType }): string {
  if (field?.dataType === "date" || field?.dataType === "datetime") {
    return dateOperatorLabels[operator] ?? operatorLabels[operator];
  }
  return operatorLabels[operator];
}

export function operatorShortLabel(operator: FilterOperator): string {
  return shortLabels[operator];
}

export function ensureOperator(
  field: { dataType?: FieldDataType; options?: readonly string[] },
  operator: FilterOperator,
): FilterOperator {
  const allowed = operatorsForField(field);
  return allowed.includes(operator) ? operator : allowed[0];
}

export function operatorsForDataType(dataType: FieldDataType): readonly FilterOperator[] {
  return operatorsForField({ dataType });
}
