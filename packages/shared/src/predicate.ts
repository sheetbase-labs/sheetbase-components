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

// Only strings that look like dates are parsed — Date.parse is lenient enough
// to reinterpret product codes ("5-10") and ranges. Hosts supplying non-ISO
// date strings still get no match.
function asDate(value: unknown): number | null {
  if (value instanceof Date) {
    const stamp = value.getTime();
    return Number.isNaN(stamp) ? null : stamp;
  }
  const text = asText(value).trim();
  if (!/[-/:]/.test(text) || !/\d{4}/.test(text)) return null;
  const stamp = Date.parse(text);
  return Number.isNaN(stamp) ? null : stamp;
}

type Comparable = { kind: "num" | "date"; value: number };

function asComparable(value: unknown): Comparable | null {
  const n = asNum(value);
  if (n !== null) return { kind: "num", value: n };
  const d = asDate(value);
  return d === null ? null : { kind: "date", value: d };
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
  const aDate = asDate(actual);
  const bDate = asDate(expected);
  if (aDate !== null && bDate !== null) return aDate === bDate;
  return asText(actual).toLowerCase() === asText(expected).toLowerCase();
}

function betweenBounds(value: unknown): { low: Comparable; high: Comparable } | null {
  let lowRaw: unknown;
  let highRaw: unknown;
  if (Array.isArray(value) && value.length >= 2) {
    [lowRaw, highRaw] = value;
  } else if (value && typeof value === "object" && "low" in value && "high" in value) {
    lowRaw = (value as { low: unknown }).low;
    highRaw = (value as { high: unknown }).high;
  } else {
    return null;
  }
  const low = asComparable(lowRaw);
  const high = asComparable(highRaw);
  if (low === null || high === null || low.kind !== high.kind) return null;
  return { low, high };
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
      const a = asComparable(actual);
      const bounds = betweenBounds(clause.value);
      if (a === null || !bounds || a.kind !== bounds.low.kind) return false;
      return a.value >= Math.min(bounds.low.value, bounds.high.value)
        && a.value <= Math.max(bounds.low.value, bounds.high.value);
    }
    case "withinLastDays": {
      const days = asNum(clause.value);
      if (days === null || days <= 0) return false;
      const stamp = asDate(actual);
      if (stamp === null) return false;
      // Calendar days inclusive of today (UTC), matching the reference server:
      // withinLastDays(1) means "today".
      const day = new Date(stamp).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      return day >= start && day <= today;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asComparable(actual);
      const b = asComparable(clause.value);
      if (a === null || b === null || a.kind !== b.kind) return false;
      if (clause.operator === "gt") return a.value > b.value;
      if (clause.operator === "gte") return a.value >= b.value;
      if (clause.operator === "lt") return a.value < b.value;
      return a.value <= b.value;
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
