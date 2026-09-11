import type { FieldDataType } from "sheetbase-shared";
import { primaryKeyOf, validateGraph } from "./graph";
import type { SchemaField, SchemaGraph, SchemaModel } from "./types";

/**
 * SchemaGraph → Postgres-flavoured `create table` DDL. This is the write-side
 * counterpart to `onHeaderFieldsChange`: the editor proposes, the host decides
 * what to run. Emission is `create table` only — alter-table diffing is v2.
 */

export class SchemaValidationError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`Schema is not valid:\n${errors.join("\n")}`);
    this.name = "SchemaValidationError";
    this.errors = errors;
  }
}

/** SQL identifier quoting: doubles inner quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const COLUMN_TYPES: Record<Exclude<FieldDataType, "relationship">, string> = {
  text: "text",
  number: "numeric",
  boolean: "boolean",
  date: "date",
  datetime: "timestamptz",
};

function referencedField(graph: SchemaGraph, field: SchemaField): SchemaField | undefined {
  const ref = field.references;
  if (!ref) return undefined;
  const model = graph.models.find((m) => m.name === ref.model);
  if (!model) return undefined;
  const key = ref.field ?? primaryKeyOf(model);
  return key ? model.fields.find((f) => f.key === key) : undefined;
}

function columnType(graph: SchemaGraph, model: SchemaModel, field: SchemaField): string {
  if (field.type !== "relationship") return COLUMN_TYPES[field.type] ?? "text";
  // FK column takes the referenced PK's SQL type; text when unresolvable.
  const target = referencedField(graph, field);
  if (!target || target.type === "relationship") return "text";
  return COLUMN_TYPES[target.type] ?? "text";
}

function columnDdl(graph: SchemaGraph, model: SchemaModel, field: SchemaField): string {
  const parts = [`  ${quoteIdent(field.key)} ${columnType(graph, model, field)}`];
  if (field.primaryKey) parts.push("primary key");
  else if (field.nullable === false) parts.push("not null");
  if (field.type === "relationship" && field.references) {
    const ref = field.references;
    const target = graph.models.find((m) => m.name === ref.model);
    if (target) {
      const key = ref.field ?? primaryKeyOf(target);
      if (key) parts.push(`references ${quoteIdent(target.name)}(${quoteIdent(key)})`);
    }
    // Dangling refs are reported by validateGraph — emission refuses before this.
  }
  return parts.join(" ");
}

/**
 * Emit `create table` statements for every model, in graph order.
 * Throws SchemaValidationError when `validateGraph` reports problems — a host
 * should never receive DDL for a schema the editor itself flags.
 */
export function graphToDdl(graph: SchemaGraph): string {
  const errors = validateGraph(graph);
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return graph.models
    .map((model) => `create table ${quoteIdent(model.name)} (\n${model.fields.map((field) => columnDdl(graph, model, field)).join(",\n")}\n);`)
    .join("\n\n");
}

/**
 * The non-SQL form of the same contract: a cleaned provisioning payload for
 * hosts that provision datasets via API rather than DDL.
 */
export function graphToProvision(graph: SchemaGraph): Readonly<{
  models: readonly Readonly<{
    name: string;
    label?: string;
    fields: readonly Readonly<{
      key: string;
      label?: string;
      type: FieldDataType;
      nullable?: boolean;
      primaryKey?: boolean;
      references?: Readonly<{ model: string; field?: string }>;
    }>[];
  }>[];
}> {
  const errors = validateGraph(graph);
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return {
    models: graph.models.map((model) => ({
      name: model.name,
      ...(model.label ? { label: model.label } : {}),
      fields: model.fields.map((field) => ({
        key: field.key,
        ...(field.label ? { label: field.label } : {}),
        type: field.type,
        ...(field.nullable !== undefined ? { nullable: field.nullable } : {}),
        ...(field.primaryKey ? { primaryKey: true } : {}),
        ...(field.references ? { references: field.references } : {}),
      })),
    })),
  };
}
