import type { FilterClause } from "./query";
import type { FilterOperator } from "./operators";
import { normaliseOperator } from "./operators";

export type Row = Record<string, unknown>;

function cell(row: Row, field: string): unknown {
  if (field in row) return row[field];
  const lower = field.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) return row[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function looseEqual(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "boolean") {
    if (typeof actual === "boolean") return actual === expected;
    const t = asText(actual).toLowerCase();
    return expected ? t === "true" || t === "yes" || t === "1" : t === "false" || t === "no" || t === "0";
  }
  const aNum = asNum(actual);
  const bNum = asNum(expected as string | number);
  if (aNum !== null && bNum !== null && asText(expected).trim() !== "") return aNum === bNum;
  return asText(actual).toLowerCase() === asText(expected).toLowerCase();
}

function betweenBounds(value: unknown): { low: number; high: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const low = asNum(value[0]);
    const high = asNum(value[1]);
    if (low === null || high === null) return null;
    return { low, high };
  }
  if (value && typeof value === "object" && "low" in value && "high" in value) {
    const low = asNum((value as { low: unknown }).low);
    const high = asNum((value as { high: unknown }).high);
    if (low === null || high === null) return null;
    return { low, high };
  }
  return null;
}

export type LooseClause = Readonly<{
  field?: string;
  fieldId?: string;
  operator: string;
  value?: unknown;
  value2?: unknown;
  values?: readonly unknown[];
}>;

/** Accept table, explorer, rules and search clause shapes. */
export function toFilterClause(input: LooseClause): FilterClause | undefined {
  const operator = normaliseOperator(input.operator);
  if (!operator) return undefined;
  const fieldId = input.fieldId ?? input.field ?? "";
  if (operator === "in") {
    const values = input.values ?? (Array.isArray(input.value) ? input.value : undefined);
    return { fieldId, operator, value: values };
  }
  if (operator === "between") {
    if (input.value2 !== undefined) return { fieldId, operator, value: [input.value, input.value2] };
    return { fieldId, operator, value: input.value };
  }
  return { fieldId, operator, value: input.value };
}

export function testCondition(row: Row, clause: FilterClause): boolean {
  const actual = cell(row, clause.fieldId);
  switch (clause.operator as FilterOperator) {
    case "isNull":
      return actual === null || actual === undefined || asText(actual).trim() === "";
    case "notNull":
      return !(actual === null || actual === undefined || asText(actual).trim() === "");
    case "eq":
      return looseEqual(actual, clause.value);
    case "neq":
      return !looseEqual(actual, clause.value);
    case "contains":
      return asText(actual).toLowerCase().includes(asText(clause.value).toLowerCase());
    case "startsWith":
      return asText(actual).toLowerCase().startsWith(asText(clause.value).toLowerCase());
    case "endsWith":
      return asText(actual).toLowerCase().endsWith(asText(clause.value).toLowerCase());
    case "in":
      return Array.isArray(clause.value) && clause.value.some((v) => looseEqual(actual, v));
    case "between": {
      const n = asNum(actual);
      const bounds = betweenBounds(clause.value);
      if (n === null || !bounds) return false;
      return n >= Math.min(bounds.low, bounds.high) && n <= Math.max(bounds.low, bounds.high);
    }
    case "withinLastDays": {
      const days = asNum(clause.value);
      if (days === null || days <= 0) return false;
      const stamp = Date.parse(asText(actual));
      if (Number.isNaN(stamp)) return false;
      const age = Date.now() - stamp;
      return age >= 0 && age <= days * 86_400_000;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNum(actual);
      const b = asNum(clause.value as string | number);
      if (a === null || b === null) return false;
      if (clause.operator === "gt") return a > b;
      if (clause.operator === "gte") return a >= b;
      if (clause.operator === "lt") return a < b;
      return a <= b;
    }
  }
}

export function matchClauses(
  row: Row,
  clauses: readonly FilterClause[],
  logic: "and" | "or" = "and",
): boolean {
  if (clauses.length === 0) return true;
  return logic === "or"
    ? clauses.some((clause) => testCondition(row, clause))
    : clauses.every((clause) => testCondition(row, clause));
}

export function filterRows<T extends Row>(
  rows: readonly T[],
  clauses: readonly FilterClause[],
  logic: "and" | "or" = "and",
): T[] {
  if (clauses.length === 0) return [...rows];
  return rows.filter((row) => matchClauses(row, clauses, logic));
}
