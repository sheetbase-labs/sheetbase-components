/** Canonical Sheetbase field data types — used by table, schema, search, rules and explorer. */
export type FieldDataType = "text" | "number" | "boolean" | "date" | "datetime" | "relationship";

/** Explorer/inference column kinds. `string` maps to `text`. */
export type ColumnKind = "number" | "string" | "boolean" | "date";

export type FieldReference = Readonly<{ model: string; field?: string }>;

export type SheetbaseField = Readonly<{
  id: string;
  label: string;
  dataType: FieldDataType;
  options?: readonly string[];
  required?: boolean;
  writable?: boolean;
  computed?: boolean;
  multiple?: boolean;
  nullable?: boolean;
  primaryKey?: boolean;
  unit?: string;
  precision?: number;
  references?: FieldReference;
}>;

const DATA_TYPES = new Set<string>(["text", "number", "boolean", "date", "datetime", "relationship"]);

/** Map legacy or inferred type names onto the canonical vocabulary. */
export function toFieldDataType(raw: string | undefined): FieldDataType {
  if (!raw) return "text";
  const lower = raw.toLowerCase();
  if (lower === "string") return "text";
  if (lower === "relation") return "relationship";
  if (DATA_TYPES.has(lower)) return lower as FieldDataType;
  return "text";
}

export function toColumnKind(dataType: FieldDataType): ColumnKind {
  if (dataType === "number") return "number";
  if (dataType === "boolean") return "boolean";
  if (dataType === "date" || dataType === "datetime") return "date";
  return "string";
}

export function fieldFromColumn(column: { key: string; kind: ColumnKind; nullable?: boolean }): SheetbaseField {
  return {
    id: column.key,
    label: column.key,
    dataType: toFieldDataType(column.kind),
    nullable: column.nullable,
  };
}

export function fieldFromSchema(field: {
  key: string;
  label?: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  references?: FieldReference;
}): SheetbaseField {
  return {
    id: field.key,
    label: field.label ?? field.key,
    dataType: toFieldDataType(field.type),
    nullable: field.nullable,
    primaryKey: field.primaryKey,
    references: field.references,
  };
}
