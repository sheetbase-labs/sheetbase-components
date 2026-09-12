import type { FieldDataType } from "sheetbase-shared";
import { primaryKeyOf, validateGraph, withAutoLayout } from "./graph";
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

export class SchemaParseError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`Could not parse DDL:\n${errors.join("\n")}`);
    this.name = "SchemaParseError";
    this.errors = errors;
  }
}

/** Postgres type names → FieldDataType. Anything unmapped imports as `text`. */
const TYPE_ALIASES: Record<string, Exclude<FieldDataType, "relationship">> = {
  text: "text",
  varchar: "text",
  "character varying": "text",
  char: "text",
  character: "text",
  uuid: "text",
  json: "text",
  jsonb: "text",
  numeric: "number",
  decimal: "number",
  int: "number",
  integer: "number",
  bigint: "number",
  smallint: "number",
  serial: "number",
  bigserial: "number",
  real: "number",
  double: "number",
  "double precision": "number",
  float: "number",
  boolean: "boolean",
  bool: "boolean",
  date: "date",
  timestamptz: "datetime",
  timestamp: "datetime",
  "timestamp with time zone": "datetime",
  "timestamp without time zone": "datetime",
};

/** Unquote `"ident"`; dotted `schema.table` keeps its last segment. */
function parseIdent(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  const last = trimmed.split(".").pop() ?? trimmed;
  return last;
}

/** Split a table body on commas that sit outside parens and quotes. */
function splitDefs(body: string): string[] {
  const defs: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuote) {
      if (ch === '"' && body[i + 1] === '"') i += 1;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) { defs.push(body.slice(start, i)); start = i + 1; }
  }
  defs.push(body.slice(start));
  return defs.map((d) => d.trim()).filter(Boolean);
}

/** One identifier, quoted or bare/schema-qualified. Non-capturing so it can be embedded inside larger patterns without leaking its alternation. */
const IDENT = `(?:"(?:[^"]|"")+"|[\\w.]+)`;

function parseColumnDef(def: string): SchemaField | "constraint" {
  let rest = def;
  const constraint = rest.match(/^constraint\s+("[^"]+"|\w+)\s+/i);
  if (constraint) rest = rest.slice(constraint[0].length).trimStart();

  // Table-level constraints map onto fields parsed already.
  const pk = rest.match(new RegExp(`^primary\\s+key\\s*\\((${IDENT}(?:\\s*,\\s*${IDENT})*)\\)`, "i"));
  if (pk) return "constraint"; // handled by the caller against the field list
  const fk = rest.match(new RegExp(`^foreign\\s+key\\s*\\((${IDENT}(?:\\s*,\\s*${IDENT})*)\\)\\s+references\\s+(${IDENT})(?:\\s*\\((${IDENT}(?:\\s*,\\s*${IDENT})*)\\))?`, "i"));
  if (fk) return "constraint";
  if (/^(unique|check|exclude)\b/i.test(rest)) return "constraint";

  const column = rest.match(new RegExp(`^(${IDENT})\\s+([\\w ]+?)(\\s*\\([^)]*\\))?(\\s+|$)`, "i"));
  if (!column) return "constraint";
  const [, identToken, rawType] = column;
  const type = TYPE_ALIASES[rawType.trim().toLowerCase()] ?? "text";
  const field: SchemaField = { key: parseIdent(identToken), type };
  const mods = rest.slice(column[0].length);
  if (/primary\s+key/i.test(mods)) field.primaryKey = true;
  if (/not\s+null/i.test(mods)) field.nullable = false;
  const ref = mods.match(new RegExp(`references\\s+(${IDENT})(?:\\s*\\(${IDENT}\\))?`, "i"));
  if (ref) {
    field.type = "relationship";
    const refField = mods.match(new RegExp(`references\\s+${IDENT}\\s*\\((${IDENT})\\)`, "i"));
    field.references = { model: parseIdent(ref[1]), ...(refField ? { field: parseIdent(refField[1]) } : {}) };
  }
  return field;
}

/**
 * Parse `create table` DDL back into a SchemaGraph — the import counterpart
 * to `graphToDdl`. Understands the emitted grammar plus the common Postgres
 * spellings (`if not exists`, schema-qualified names, `varchar`/`int`/
 * `serial` aliases, table-level `primary key`/`foreign key` constraints).
 * Unknown column types import as `text`. Throws SchemaParseError when no
 * statement yields a model.
 */
export function ddlToGraph(sql: string): SchemaGraph {
  const models: SchemaModel[] = [];
  const errors: string[] = [];
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    const match = statement.match(new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})\\s*\\(([\\s\\S]*)`, "i"));
    if (!match) { errors.push(`skipped statement: ${statement.slice(0, 60)}…`); continue; }
    const name = parseIdent(match[1]);
    const body = match[2].replace(/\)\s*$/, "");
    const fields: SchemaField[] = [];
    const deferred: string[] = [];
    for (const def of splitDefs(body)) {
      const parsed = parseColumnDef(def);
      if (parsed === "constraint") deferred.push(def);
      else fields.push(parsed);
    }
    // Second pass: table-level constraints resolve against parsed fields.
    for (const def of deferred) {
      let rest = def;
      const constraint = rest.match(/^constraint\s+("[^"]+"|\w+)\s+/i);
      if (constraint) rest = rest.slice(constraint[0].length).trimStart();
      const pk = rest.match(new RegExp(`^primary\\s+key\\s*\\((${IDENT}(?:\\s*,\\s*${IDENT})*)\\)`, "i"));
      if (pk) {
        for (const token of pk[1].split(",")) {
          const field = fields.find((f) => f.key === parseIdent(token));
          if (field) { field.primaryKey = true; field.nullable = false; }
        }
        continue;
      }
      const fk = rest.match(new RegExp(`^foreign\\s+key\\s*\\((${IDENT})\\)\\s+references\\s+(${IDENT})(?:\\s*\\((${IDENT})\\))?`, "i"));
      if (fk) {
        const field = fields.find((f) => f.key === parseIdent(fk[1]));
        if (field) {
          field.type = "relationship";
          field.references = { model: parseIdent(fk[2]), ...(fk[3] ? { field: parseIdent(fk[3]) } : {}) };
        }
      }
    }
    if (fields.length === 0) { errors.push(`create table ${name}: no columns parsed`); continue; }
    models.push({ name, fields });
  }
  if (models.length === 0) {
    throw new SchemaParseError(errors.length > 0 ? errors : ["no create table statements found"]);
  }
  // Normalise: an explicit `references (pk)` restates the implicit target —
  // drop it so round-tripped graphs match the hand-built shape.
  for (const model of models) {
    for (const field of model.fields) {
      if (!field.references?.field) continue;
      const target = models.find((m) => m.name === field.references!.model);
      if (target && field.references.field === primaryKeyOf(target)) {
        field.references = { model: field.references.model };
      }
    }
  }
  return withAutoLayout({ models });
}
