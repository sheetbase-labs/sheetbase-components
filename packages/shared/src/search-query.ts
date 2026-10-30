import type { SheetbaseField } from "./fields";
import type { FilterOperator } from "./operators";
import { emptyGroup, type ConditionNode, type FilterNode, type GroupNode } from "./tree";

/**
 * Search box syntax. Field tokens narrow the search; everything else is free
 * text for the server's full-text search.
 *
 *   status:approved          field equals (contains, for plain text fields)
 *   status:"in review"       a value with spaces
 *   status:=approved         exactly equals, even on a plain text field
 *   -status:approved         NOT
 *   status:a,b               any of
 *   osmolality:>300          > >= < <= (numbers and dates)
 *   created:<2026-10-01
 *   osmolality:280..320      between
 *
 * Field keys match a field's id or label, ignoring case. A token whose key is
 * not a field stays free text, as do quotes, `-word` and `OR`.
 */
export type ParsedSearchQuery = Readonly<{ text: string; filter: GroupNode }>;

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_q${counter.toString(36)}`;
}

function normalKey(key: string): string {
  return key.trim().toLowerCase();
}

function fieldLookup(fields: readonly SheetbaseField[]): Map<string, SheetbaseField> {
  const map = new Map<string, SheetbaseField>();
  // Labels first so an id wins when it collides with another field's label.
  for (const field of fields) {
    map.set(normalKey(field.label), field);
    map.set(normalKey(field.label).replace(/\s+/g, "_"), field);
    map.set(normalKey(field.label).replace(/\s+/g, ""), field);
  }
  for (const field of fields) map.set(normalKey(field.id), field);
  return map;
}

/** Split on whitespace outside double quotes. Raw slices are kept verbatim. */
function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted && ch === "\\" && i + 1 < input.length) {
      current += ch + input[i + 1];
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (!quoted && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Split a value on `sep` outside double quotes and unquote each piece. */
function splitValues(raw: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quoted && ch === "\\" && i + 1 < raw.length) {
      current += raw[i + 1];
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && raw.startsWith(sep, i)) {
      parts.push(current);
      current = "";
      i += sep.length - 1;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function coerce(field: SheetbaseField, raw: string): unknown | undefined {
  if (field.dataType === "number") {
    const n = Number(raw.replace(/,/g, ""));
    return raw.trim() !== "" && Number.isFinite(n) ? n : undefined;
  }
  if (field.dataType === "boolean") {
    const lower = raw.toLowerCase();
    if (lower === "true" || lower === "yes") return true;
    if (lower === "false" || lower === "no") return false;
    return undefined;
  }
  return raw === "" ? undefined : raw;
}

const COMPARATORS: ReadonlyArray<readonly [string, FilterOperator]> = [
  [">=", "gte"],
  ["<=", "lte"],
  [">", "gt"],
  ["<", "lt"],
];

function ordered(field: SheetbaseField): boolean {
  return field.dataType === "number" || field.dataType === "date" || field.dataType === "datetime";
}

function condition(field: SheetbaseField, operator: FilterOperator, value: unknown): ConditionNode {
  return { type: "condition", id: nextId("cnd"), field: field.id, operator, value };
}

function conditionFor(field: SheetbaseField, rawValue: string): ConditionNode | undefined {
  if (rawValue.startsWith("=")) {
    const value = coerce(field, splitValues(rawValue.slice(1), "\u0000")[0]);
    return value === undefined ? undefined : condition(field, "eq", value);
  }
  if (ordered(field)) {
    for (const [prefix, operator] of COMPARATORS) {
      if (!rawValue.startsWith(prefix)) continue;
      const value = coerce(field, splitValues(rawValue.slice(prefix.length), "\u0000")[0]);
      return value === undefined ? undefined : condition(field, operator, value);
    }
    const range = splitValues(rawValue, "..");
    if (range.length === 2) {
      const low = coerce(field, range[0]);
      const high = coerce(field, range[1]);
      if (low !== undefined && high !== undefined) return condition(field, "between", [low, high]);
    }
  }
  const pieces = splitValues(rawValue, ",");
  if (pieces.length > 1) {
    const values = pieces.map((piece) => coerce(field, piece));
    if (values.some((value) => value === undefined)) return undefined;
    return condition(field, "in", values);
  }
  const value = coerce(field, pieces[0]);
  if (value === undefined) return undefined;
  const plainText = field.dataType === "text" && !field.options?.length && !field.loadOptions;
  return condition(field, plainText ? "contains" : "eq", value);
}

/** Split a search box string into free text and a filter tree over `fields`. */
export function parseSearchQuery(input: string, fields: readonly SheetbaseField[]): ParsedSearchQuery {
  const lookup = fieldLookup(fields);
  const text: string[] = [];
  const children: FilterNode[] = [];
  for (const token of tokenise(input)) {
    const negated = token.startsWith("-");
    const body = negated ? token.slice(1) : token;
    const colon = body.indexOf(":");
    const key = colon > 0 && !body.slice(0, colon).includes('"') ? body.slice(0, colon) : "";
    const field = key ? lookup.get(normalKey(key)) : undefined;
    const node = field ? conditionFor(field, body.slice(colon + 1)) : undefined;
    if (!node) {
      text.push(token);
    } else if (negated) {
      children.push({ ...emptyGroup("NOT"), id: nextId("grp"), children: [node] });
    } else {
      children.push(node);
    }
  }
  return { text: text.join(" "), filter: { ...emptyGroup("AND"), id: nextId("grp"), children } };
}

function quoteValue(value: string): string {
  return /[\s,"]|\.\.|^[=<>]/.test(value) || value === "" ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
}

function keyFor(field: SheetbaseField | undefined, id: string): string {
  const key = field?.id ?? id;
  return /[\s:"]/.test(key) ? "" : key;
}

function tokenFor(node: ConditionNode, fields: ReadonlyMap<string, SheetbaseField>): { token: string; negated: boolean } | undefined {
  const field = fields.get(node.field);
  const key = keyFor(field, node.field);
  if (!key || !field) return undefined;
  const plainText = field.dataType === "text" && !field.options?.length && !field.loadOptions;
  const one = (value: unknown) => quoteValue(String(value));
  const operator = node.operator;
  if (operator === "eq" || operator === "neq") {
    if (node.value === undefined || node.value === null || node.value === "") return undefined;
    const value = one(node.value);
    return { token: `${key}:${plainText ? "=" : ""}${value}`, negated: operator === "neq" };
  }
  if (operator === "contains" && plainText) {
    if (typeof node.value !== "string" || node.value === "") return undefined;
    return { token: `${key}:${one(node.value)}`, negated: false };
  }
  if (operator === "in" && Array.isArray(node.value) && node.value.length > 1) {
    return { token: `${key}:${node.value.map(one).join(",")}`, negated: false };
  }
  if (ordered(field)) {
    for (const [prefix, op] of COMPARATORS) {
      if (op === operator && node.value !== undefined && node.value !== null && node.value !== "") {
        return { token: `${key}:${prefix}${one(node.value)}`, negated: false };
      }
    }
    if (operator === "between" && Array.isArray(node.value) && node.value.length === 2) {
      return { token: `${key}:${one(node.value[0])}..${one(node.value[1])}`, negated: false };
    }
  }
  return undefined;
}

function expressible(child: FilterNode, fields: ReadonlyMap<string, SheetbaseField>): string | undefined {
  if (child.type === "condition") {
    const out = tokenFor(child, fields);
    if (!out) return undefined;
    return out.negated ? `-${out.token}` : out.token;
  }
  if (child.combinator === "NOT" && child.children.length === 1 && child.children[0].type === "condition") {
    const out = tokenFor(child.children[0], fields);
    return out && !out.negated ? `-${out.token}` : undefined;
  }
  return undefined;
}

/**
 * Whether the search box can show every part of `filter`. OR groups, NOT over
 * several conditions and operators with no token (starts with, is empty…) need
 * the filter builder instead.
 */
export function isQueryExpressible(filter: GroupNode, fields: readonly SheetbaseField[]): boolean {
  if (filter.combinator !== "AND") return false;
  const byId = new Map(fields.map((field) => [field.id, field]));
  return filter.children.every((child) => expressible(child, byId) !== undefined);
}

/** The inverse of `parseSearchQuery`: free text, then one token per expressible condition. */
export function formatSearchQuery(query: ParsedSearchQuery, fields: readonly SheetbaseField[]): string {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const tokens: string[] = [];
  if (query.text.trim()) tokens.push(query.text.trim());
  if (query.filter.combinator === "AND") {
    for (const child of query.filter.children) {
      const token = expressible(child, byId);
      if (token) tokens.push(token);
    }
  }
  return tokens.join(" ");
}
