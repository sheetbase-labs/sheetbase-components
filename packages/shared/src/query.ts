import type { FieldDataType, SheetbaseField } from "./fields";
import type { FilterOperator } from "./operators";
import { ensureOperator } from "./operators";

export type SortDirection = "asc" | "desc";
export type SortClause = Readonly<{ fieldId: string; direction: SortDirection; nulls?: "first" | "last" }>;
export type FilterClause = Readonly<{ fieldId: string; operator: FilterOperator; value?: unknown }>;
export type DatasetQuery = Readonly<{
  sort?: readonly SortClause[];
  filters?: readonly FilterClause[];
  filterLogic?: "and" | "or";
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function queryKey(query: DatasetQuery): string {
  return JSON.stringify(canonical({
    filters: query.filters ?? [],
    filterLogic: query.filterLogic ?? "and",
    sort: query.sort ?? [],
  }));
}

export type FilterValueInput = Readonly<{ value?: string; value2?: string; values?: readonly string[] }>;

/**
 * Build the serialisable clause value from raw control input.
 * Returns undefined when the input is incomplete so callers skip adding the filter.
 */
export function buildFilterValue(
  field: { dataType?: FieldDataType },
  operator: FilterOperator,
  input: FilterValueInput,
): { value?: unknown } | undefined {
  if (operator === "isNull" || operator === "notNull") return {};
  if (operator === "in") {
    const values = input.values ?? [];
    return values.length > 0 ? { value: values } : undefined;
  }
  if (operator === "between") {
    const [min, max] = typedPair(field, input.value ?? "", input.value2 ?? "");
    return min !== undefined && max !== undefined ? { value: [min, max] } : undefined;
  }
  if (operator === "withinLastDays") {
    const days = Number(input.value);
    return Number.isFinite(days) && days > 0 ? { value: Math.round(days) } : undefined;
  }
  if (input.value === undefined || input.value === "") return undefined;
  const typed = typedScalar(field, input.value);
  return typed === undefined ? undefined : { value: typed };
}

function typedPair(
  field: { dataType?: FieldDataType },
  first: string,
  second: string,
): readonly [unknown, unknown] | readonly [undefined, undefined] {
  const min = first === "" ? undefined : typedScalar(field, first);
  const max = second === "" ? undefined : typedScalar(field, second);
  return min === undefined || max === undefined ? [undefined, undefined] : [min, max];
}

function typedScalar(field: { dataType?: FieldDataType }, raw: string): unknown {
  if (field.dataType === "number") return raw === "" ? undefined : Number(raw);
  if (field.dataType === "boolean") return raw === "true";
  return raw;
}

export function filterValueSummary(clause: FilterClause): string {
  if (clause.operator === "isNull" || clause.operator === "notNull") return "";
  if (clause.operator === "withinLastDays") return `${String(clause.value)} days`;
  if (clause.operator === "between" && Array.isArray(clause.value)) {
    const [min, max] = clause.value;
    return `${String(min)} – ${String(max)}`;
  }
  if (clause.operator === "in" && Array.isArray(clause.value)) return clause.value.map(String).join(", ");
  return String(clause.value ?? "");
}

export function clauseForField(
  field: SheetbaseField,
  operator: FilterOperator,
  input: FilterValueInput,
): FilterClause | undefined {
  const nextOperator = ensureOperator(field, operator);
  const built = buildFilterValue(field, nextOperator, input);
  if (!built) return undefined;
  return { fieldId: field.id, operator: nextOperator, ...built };
}
