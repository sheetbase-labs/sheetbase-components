import type { FieldDataType } from "@sheetbase-labs/sheetbase-shared";
import { parseCreateTables, SchemaParseError } from "./ddl";
import { nodeHeight, relationEdgeId, withAutoLayout } from "./graph";
import type { SchemaField, SchemaGraph, SchemaModel, SchemaModelKind, SchemaRelation } from "./types";

/**
 * Best-effort SQL → SchemaGraph analysis for the schema canvas: paste or drop
 * query SQL (Trino/Postgres/DuckDB flavoured) and get the tables it touches,
 * the joins between them, the CTEs/subqueries it builds, and the result
 * columns — drawn as an ERD.
 *
 * This is a structural reader, not a full parser: it understands `with`,
 * `select`, `from`, joins (`on`/`using`), casts, common aggregates and
 * `create view`/CTAS. Anything it cannot read is reported in `warnings` and
 * the rest of the graph is still built. `create table` statements are
 * delegated to `parseCreateTables`, so DDL and queries can be imported
 * together.
 */

export interface SqlAnalysis {
  graph: SchemaGraph;
  /** Non-fatal problems: skipped statements, unresolved columns, unknown `*` expansions. */
  warnings: string[];
}

/** Convenience wrapper when the warnings are not needed. Throws `SchemaParseError` when nothing parses. */
export function sqlToGraph(sql: string): SchemaGraph {
  return analyzeSql(sql).graph;
}

/** Analyse a SQL script (DDL, queries, or both) into a graph. */
export function analyzeSql(sql: string): SqlAnalysis {
  return new SqlAnalyzer(sql).analyze();
}

// ── tokenizer ───────────────────────────────────────────────────────────────

type TokenKind = "word" | "ident" | "string" | "number" | "punct";

interface Token {
  kind: TokenKind;
  /** Normalised: unquoted words are lower-cased, quoted identifiers unescaped. */
  value: string;
  raw: string;
  start: number;
  end: number;
}

const TWO_CHAR_PUNCT = new Set(["::", "<=", ">=", "<>", "!=", "||", "->", "=>"]);
const NUMBER_PATTERN = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;

/** Replace comments with spaces, length-preserving, so token offsets still slice the source. */
function maskComments(source: string): string {
  const out = source.split("");
  let quote: "'" | '"' | "`" | null = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;
    if (quote) {
      if (ch === quote) {
        if (source[i + 1] === quote) { i += 2; continue; }
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; i += 1; continue; }
    if (ch === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") { out[i] = " "; i += 1; }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      let depth = 1;
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") { depth += 1; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (source[i] === "*" && source[i + 1] === "/") { depth -= 1; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (source[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** dbt Jinja: `{{ source('raw', 'runs') }}` → `raw.runs`, `{{ ref('stg_x') }}` → `stg_x`. Other tags become spaces. */
const JINJA_PATTERN = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g;

function expandDbtJinja(source: string, refs: Set<string>): string {
  return source.replace(JINJA_PATTERN, (match, expression: string | undefined) => {
    if (expression) {
      const call = expression.match(/^\s*(source|ref)\s*\(\s*([\s\S]*?)\s*\)\s*$/);
      if (call) {
        const names = [...call[2].matchAll(/'([^']*)'|"([^"]*)"/g)]
          .map((quoted) => quoted[1] ?? quoted[2])
          .filter((name): name is string => Boolean(name));
        if (names.length > 0) {
          if (call[1] === "ref") refs.add(names[names.length - 1]);
          const name = call[1] === "source" ? names.join(".") : names[names.length - 1];
          // Length-preserving so token offsets still slice the original source.
          return name + " ".repeat(Math.max(0, match.length - name.length));
        }
      }
    }
    return " ".repeat(match.length);
  });
}

/**
 * A `-- model_name.sql` comment immediately above a statement (as the file
 * picker writes, and as dbt projects are usually concatenated) names that
 * statement's result node.
 */
function statementModelName(rawSource: string, start: number): string | undefined {
  const lines = rawSource.slice(0, start).split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith("--")) break;
    const match = line.match(/^--\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\.sql\s*$/);
    if (match) return match[1];
  }
  return undefined;
}

/** `{{ ref('...') }}` model names used by one statement. */
function statementRefs(rawSource: string, tokens: Token[]): string[] {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return [];
  const slice = rawSource.slice(first.start, last.end);
  const refs: string[] = [];
  for (const match of slice.matchAll(JINJA_PATTERN)) {
    const expression = match[1];
    if (!expression) continue;
    const call = expression.match(/^\s*ref\s*\(\s*([\s\S]*?)\s*\)\s*$/);
    if (!call) continue;
    const names = [...call[1].matchAll(/'([^']*)'|"([^"]*)"/g)]
      .map((quoted) => quoted[1] ?? quoted[2])
      .filter((name): name is string => Boolean(name));
    if (names.length > 0) refs.push(names[names.length - 1]);
  }
  return refs;
}

/**
 * Order statements so a dbt model is parsed before the statements that ref
 * it — files arrive in any order (alphabetical uploads, pasted marts first).
 * Cycles and unknown refs keep their original relative order.
 */
function orderByRefs<T extends { tokens: Token[]; model?: string; refs: string[] }>(queries: T[]): T[] {
  const declared = new Set(queries.map((query) => query.model).filter((name): name is string => Boolean(name)));
  const ordered: T[] = [];
  const done = new Set<string>();
  let pending = [...queries];
  while (pending.length > 0) {
    const next: T[] = [];
    for (const query of pending) {
      if (query.refs.some((name) => declared.has(name) && !done.has(name))) { next.push(query); continue; }
      ordered.push(query);
      if (query.model) done.add(query.model);
    }
    if (next.length === pending.length) return [...ordered, ...next];
    pending = next;
  }
  return ordered;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) { i += 1; continue; }
    const start = i;
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < source.length) {
        if (source[i] === quote && source[i + 1] === quote) { value += quote; i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        value += source[i]; i += 1;
      }
      tokens.push({ kind: quote === "'" ? "string" : "ident", value, raw: source.slice(start, i), start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      i += 1;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
      const raw = source.slice(start, i);
      tokens.push({ kind: "word", value: raw.toLowerCase(), raw, start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const match = source.slice(i).match(NUMBER_PATTERN);
      const raw = match ? match[0] : ch;
      i += raw.length;
      tokens.push({ kind: "number", value: raw, raw, start, end: i });
      continue;
    }
    const two = source.slice(i, i + 2);
    const raw = TWO_CHAR_PUNCT.has(two) ? two : ch;
    i += raw.length;
    tokens.push({ kind: "punct", value: raw, raw, start, end: i });
  }
  return tokens;
}

// ── SQL vocabulary ──────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "all", "and", "any", "as", "asc", "between", "by", "case", "cast", "cross", "current_date", "current_time",
  "current_timestamp", "day", "delete", "desc", "distinct", "else", "end", "except", "exists", "false", "fetch",
  "first", "following", "from", "full", "group", "grouping", "having", "hour", "in", "inner", "insert", "intersect",
  "is", "join", "last", "lateral", "left", "like", "limit", "localtime", "localtimestamp", "minute", "month",
  "natural", "not", "null", "nulls", "offset", "on", "or", "order", "outer", "over", "partition", "preceding",
  "qualify", "range", "recursive", "right", "rollup", "row", "rows", "second", "select", "sets", "then", "true",
  "try_cast", "unbounded", "union", "unnest", "using", "values", "when", "where", "window", "with", "year",
  "cube",
]);

/** Words that can begin a new statement when a run of SQL omits its semicolons. */
const STATEMENT_STARTS = new Set(["select", "with", "create", "insert", "update", "delete", "drop", "alter", "values", "table", "comment", "set"]);

/** Clause words that end a free expression at paren depth 0. */
const CLAUSE_STOP = new Set([
  "where", "group", "having", "order", "limit", "offset", "fetch", "union", "intersect", "except", "window", "qualify",
]);

const SQL_TYPE_MAP: Record<string, FieldDataType> = {
  text: "text", varchar: "text", "character varying": "text", char: "text", character: "text", string: "text",
  uuid: "text", json: "text", jsonb: "text", varbinary: "text", binary: "text", ipaddress: "text", inet: "text",
  interval: "text", time: "text", "time with time zone": "text", "time without time zone": "text", blob: "text",
  clob: "text", row: "text", array: "text", map: "text",
  tinyint: "number", smallint: "number", integer: "number", int: "number", bigint: "number", decimal: "number",
  numeric: "number", number: "number", real: "number", double: "number", "double precision": "number", float: "number",
  float4: "number", float8: "number", int2: "number", int4: "number", int8: "number", money: "number",
  boolean: "boolean", bool: "boolean",
  date: "date",
  timestamp: "datetime", timestamptz: "datetime", "timestamp with time zone": "datetime",
  "timestamp without time zone": "datetime", datetime: "datetime",
};

/** Output type of common functions when the query does not cast them explicitly. */
const FUNCTION_TYPES: Record<string, FieldDataType> = {
  count: "number", count_if: "number", sum: "number", avg: "number", stddev: "number", variance: "number",
  round: "number", floor: "number", ceil: "number", ceiling: "number", abs: "number", length: "number",
  char_length: "number", cardinality: "number", year: "number", month: "number", day: "number", hour: "number",
  minute: "number", second: "number", date_diff: "number", date_add: "datetime", date_trunc: "datetime",
  from_unixtime: "datetime", now: "datetime", regexp_like: "boolean", contains: "boolean", starts_with: "boolean",
  ends_with: "boolean", lower: "text", upper: "text", concat: "text", substr: "text", substring: "text",
  trim: "text", replace: "text", format: "text", json_extract: "text", json_extract_scalar: "text",
  approx_percentile: "number", row_number: "number", rank: "number", dense_rank: "number", ntile: "number",
  grouping: "number", regexp_replace: "text", json_format: "text", json_parse: "text", map_entries: "text",
  max_by: "text", min_by: "text",
};

function sqlTypeToFieldType(raw: string): FieldDataType {
  const base = raw.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return SQL_TYPE_MAP[base] ?? "text";
}

/** A quoted column name keeps its case; an unquoted one is folded like the SQL engine does. */
function sanitizeKey(text: string, fallback: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

const NO_SPACE_BEFORE = new Set([",", ")", ".", "::", ";", "]", "["]);
const NO_SPACE_AFTER = new Set(["(", ".", "[", "::"]);
/** Keywords that are really functions — `cast(` should not render as `cast (`. */
const FUNCTION_KEYWORDS = new Set(["cast", "try_cast", "unnest"]);

/** Re-render tokens as readable SQL for labels, expressions and model bodies. */
function renderTokens(tokens: Token[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!out) { out = token.raw; continue; }
    const prev = tokens[i - 1];
    const callOpen = token.value === "(" && (prev.kind === "word" || prev.kind === "ident") && (!KEYWORDS.has(prev.value) || FUNCTION_KEYWORDS.has(prev.value));
    const space = !(NO_SPACE_BEFORE.has(token.value) || NO_SPACE_AFTER.has(prev.value) || callOpen);
    out += space ? ` ${token.raw}` : token.raw;
  }
  return out;
}

function stripOuterParens(tokens: Token[]): Token[] {
  if (tokens[0]?.value !== "(" || tokens[tokens.length - 1]?.value !== ")") return tokens;
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].value === "(") depth += 1;
    else if (tokens[i].value === ")") {
      depth -= 1;
      if (depth === 0) return i === tokens.length - 1 ? stripOuterParens(tokens.slice(1, -1)) : tokens;
    }
  }
  return tokens;
}

/** `cast(x as decimal(12, 2))` / `try_cast(x as varchar)` → `decimal(12, 2)`. */
function castTargetType(tokens: Token[]): string | undefined {
  const fn = tokens[0]?.value;
  if ((fn !== "cast" && fn !== "try_cast") || tokens[1]?.value !== "(") return undefined;
  let depth = 0;
  for (let i = 1; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (value === "(") depth += 1;
    else if (value === ")") depth -= 1;
    else if (value === "as" && depth === 1) {
      const typeTokens: Token[] = [];
      let inner = 1;
      for (let j = i + 1; j < tokens.length; j += 1) {
        const next = tokens[j];
        if (next.value === "(") inner += 1;
        else if (next.value === ")") { inner -= 1; if (inner === 0) break; }
        if (inner >= 1) typeTokens.push(next);
      }
      return renderTokens(typeTokens);
    }
  }
  return undefined;
}

interface ColumnRef {
  qualifier?: string;
  column: string;
}

// ── analyzer ────────────────────────────────────────────────────────────────

type SourceKind = "table" | "cte" | "subquery";

interface SourceRef {
  /** Qualifier used to resolve `alias.column`. */
  key: string;
  label: string;
  model: string;
  kind: SourceKind;
  /** Known output columns for derived sources. */
  fields: Map<string, SchemaField>;
  /** Base-table field count when this query first saw the model — select-list columns lead from here. */
  fieldStart: number;
  /** Columns are unknown (external dbt model) — unresolved refs stay quiet. */
  opaque?: boolean;
}

interface QueryContext {
  ctes: Map<string, SourceRef>;
}

interface QueryBody {
  outputs: SchemaField[];
  sources: SourceRef[];
}

interface SelectItem {
  tokens: Token[];
  rendered: string;
  alias?: string;
  star?: boolean;
  starSource?: string;
}

function isCreateTableStatement(tokens: Token[]): boolean {
  let i = 0;
  if (tokens[i]?.value !== "create") return false;
  i += 1;
  if (tokens[i]?.value === "or" && tokens[i + 1]?.value === "replace") i += 2;
  if (tokens[i]?.value === "temporary" || tokens[i]?.value === "temp") i += 1;
  if (tokens[i]?.value !== "table") return false;
  i += 1;
  if (tokens[i]?.value === "if" && tokens[i + 1]?.value === "not" && tokens[i + 2]?.value === "exists") i += 3;
  while (i < tokens.length && (tokens[i].kind === "word" || tokens[i].kind === "ident" || tokens[i].value === ".")) i += 1;
  return tokens[i]?.value === "(";
}

function splitStatements(tokens: Token[], rawSource: string): Token[][] {
  const statements: Token[][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (value === "(") depth += 1;
    else if (value === ")") depth = Math.max(0, depth - 1);
    else if (value === ";" && depth === 0) {
      if (i > start) statements.push(tokens.slice(start, i));
      start = i + 1;
      continue;
    }
    // A `-- name.sql` header starts a new statement even without a `;` —
    // concatenated dbt files rely on this.
    if (depth === 0 && i > start && tokens[i].kind === "word" && STATEMENT_STARTS.has(value) && statementModelName(rawSource, tokens[i].start)) {
      statements.push(tokens.slice(start, i));
      start = i;
    }
  }
  if (start < tokens.length) statements.push(tokens.slice(start));
  return statements;
}

function splitConjuncts(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.value === "(") depth += 1;
    else if (token.value === ")") depth -= 1;
    else if (depth === 0 && token.kind === "word" && (token.value === "and" || token.value === "or")) {
      if (i > start) out.push(tokens.slice(start, i));
      start = i + 1;
    }
  }
  if (start < tokens.length) out.push(tokens.slice(start));
  return out;
}

function findTopLevelEquals(tokens: Token[]): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (value === "(") depth += 1;
    else if (value === ")") depth -= 1;
    else if (depth === 0 && value === "=") return i;
  }
  return -1;
}

/** Layer query models left-to-right along lineage edges; tables in a layer stack vertically. */
function layoutQueryGraph(graph: SchemaGraph): void {
  const depth = new Map<string, number>();
  for (const model of graph.models) depth.set(model.name, 0);
  const lineage = (graph.relations ?? []).filter((relation) => relation.kind === "lineage");
  for (let pass = 0; pass <= graph.models.length; pass += 1) {
    let changed = false;
    for (const relation of lineage) {
      const from = depth.get(relation.fromModel);
      const to = depth.get(relation.toModel);
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) { depth.set(relation.toModel, from + 1); changed = true; }
    }
    if (!changed) break;
  }
  const nextY = new Map<number, number>();
  for (const model of graph.models) {
    const column = depth.get(model.name) ?? 0;
    const y = nextY.get(column) ?? 24;
    model.position = { x: 24 + column * 300, y };
    nextY.set(column, y + nodeHeight(model) + 24);
  }
}

class SqlAnalyzer {
  private readonly rawSource: string;
  private readonly source: string;
  private readonly allTokens: Token[];
  private tokens: Token[];
  private pos = 0;
  private querySeq = 0;
  private subquerySeq = 0;
  private readonly models = new Map<string, SchemaModel>();
  private readonly relations: SchemaRelation[] = [];
  private readonly relationIds = new Set<string>();
  private readonly warnings: string[] = [];
  private readonly warned = new Set<string>();
  /** dbt model names seen in `{{ ref(...) }}`. */
  private readonly refNames = new Set<string>();
  /** Model nodes created by a ref before their own statement was parsed. */
  private readonly placeholders = new Set<string>();

  constructor(sql: string) {
    this.rawSource = sql;
    this.source = maskComments(expandDbtJinja(sql, this.refNames));
    this.allTokens = tokenize(this.source);
    this.tokens = this.allTokens;
  }

  analyze(): SqlAnalysis {
    const statements = splitStatements(this.allTokens, this.rawSource);
    const ddl: string[] = [];
    const queries: { tokens: Token[]; model?: string; refs: string[] }[] = [];
    for (const statement of statements) {
      if (isCreateTableStatement(statement)) {
        ddl.push(this.source.slice(statement[0].start, statement[statement.length - 1].end));
      } else {
        queries.push({
          tokens: statement,
          model: statementModelName(this.rawSource, statement[0]?.start ?? 0),
          refs: statementRefs(this.rawSource, statement),
        });
      }
    }
    if (ddl.length > 0) {
      const parsed = parseCreateTables(ddl.join(";\n"));
      for (const message of parsed.errors) this.warn(message);
      for (const model of parsed.models) if (!this.models.has(model.name)) this.models.set(model.name, model);
    }
    const queue = orderByRefs(queries);
    let queryCount = 0;
    while (queue.length > 0) {
      const query = queue.shift();
      if (!query) break;
      this.tokens = query.tokens;
      this.pos = 0;
      this.parseStatement(query.model);
      queryCount += 1;
      // Concatenated files (dbt projects especially) often omit the `;` —
      // keep reading statements from whatever the parser did not consume.
      if (this.pos < this.tokens.length && this.pos > 0) {
        const remainder = this.tokens.slice(this.pos);
        const next = remainder[0];
        if (next && next.kind === "word" && STATEMENT_STARTS.has(next.value)) {
          queue.unshift({ tokens: remainder, model: statementModelName(this.rawSource, next.start), refs: statementRefs(this.rawSource, remainder) });
        } else if (next) {
          this.warn(`skipped ${remainder.length} trailing token${remainder.length === 1 ? "" : "s"} after a statement`);
        }
      }
    }
    this.tokens = this.allTokens;
    if (this.models.size === 0) {
      throw new SchemaParseError(this.warnings.length > 0 ? this.warnings : ["no tables or queries found"], "Could not parse SQL:");
    }
    const graph: SchemaGraph = { models: [...this.models.values()] };
    if (this.relations.length > 0) graph.relations = this.relations;
    if (queryCount > 0) layoutQueryGraph(graph);
    return { graph: withAutoLayout(graph), warnings: [...this.warnings] };
  }

  // ── statements ────────────────────────────────────────────────────────────

  private parseStatement(modelName?: string): void {
    const first = this.tokens[0];
    if (!first) return;
    const keyword = first.kind === "word" ? first.value : "";
    if (keyword === "select" || keyword === "with" || keyword === "table") {
      this.querySeq += 1;
      const body = this.parseQuery({ ctes: new Map() });
      const base = modelName ?? `query_${this.querySeq}`;
      const model = this.createDerived(base, modelName ? undefined : `Query ${this.querySeq}`, body.outputs, "query", this.textBetween(0, this.tokens.length));
      this.addLineage(model.name, body.sources);
      if (body.outputs.length === 0) this.warn(`${model.name}: no output columns recognised`);
      return;
    }
    if (keyword === "create") {
      const target = this.readCreateTarget();
      if (!target) { this.warn(`skipped statement: ${first.raw}…`); return; }
      const asIndex = this.findWordFrom(target.index, "as");
      if (asIndex < 0) { this.warn(`skipped create ${target.kind} ${target.name}`); return; }
      this.pos = asIndex + 1;
      const body = this.parseQuery({ ctes: new Map() });
      const model = this.createDerived(target.name, undefined, body.outputs, target.kind === "view" ? "view" : "query", this.textBetween(this.pos, this.tokens.length));
      this.addLineage(model.name, body.sources);
      if (body.outputs.length === 0) this.warn(`${model.name}: no output columns recognised`);
      return;
    }
    this.warn(`skipped statement: ${first.raw}…`);
  }

  private readCreateTarget(): { kind: "view" | "table"; name: string; index: number } | undefined {
    const at = (index: number) => this.tokens[index]?.value;
    let i = 1;
    if (at(i) === "or" && at(i + 1) === "replace") i += 2;
    if (at(i) === "materialized") i += 1;
    if (at(i) === "temporary" || at(i) === "temp") i += 1;
    const kind = at(i) === "view" ? "view" : at(i) === "table" ? "table" : undefined;
    if (!kind) return undefined;
    i += 1;
    if (at(i) === "if" && at(i + 1) === "not" && at(i + 2) === "exists") i += 3;
    const first = this.tokens[i];
    if (!first || (first.kind !== "word" && first.kind !== "ident")) return undefined;
    const parts: string[] = [first.value];
    i += 1;
    while (this.tokens[i]?.value === "." && (this.tokens[i + 1]?.kind === "word" || this.tokens[i + 1]?.kind === "ident")) {
      parts.push(this.tokens[i + 1].value);
      i += 2;
    }
    return { kind, name: parts.join("."), index: i };
  }

  private findWordFrom(index: number, word: string): number {
    let depth = 0;
    for (let i = index; i < this.tokens.length; i += 1) {
      const value = this.tokens[i].value;
      if (value === "(") depth += 1;
      else if (value === ")") depth -= 1;
      else if (depth === 0 && value === word) return i;
    }
    return -1;
  }

  // ── queries ───────────────────────────────────────────────────────────────

  private parseQuery(ctx: QueryContext): QueryBody {
    const ctes = new Map(ctx.ctes);
    if (this.matchWord("with")) {
      this.matchWord("recursive");
      do {
        const nameToken = this.expectIdentifier();
        if (!nameToken) break;
        const columnAliases = this.atValue("(") ? this.takeParenGroup() : [];
        this.matchWord("as");
        this.matchValue("(");
        const bodyStart = this.pos;
        const body = this.parseQuery({ ctes });
        const bodyEnd = this.pos;
        this.matchValue(")");
        const outputs = applyColumnAliases(body.outputs, columnAliases);
        const model = this.createDerived(nameToken.value, undefined, outputs, "cte", this.textBetween(bodyStart, bodyEnd));
        this.addLineage(model.name, body.sources);
        ctes.set(nameToken.value, this.sourceRef(nameToken.value, nameToken.value, model.name, "cte", outputs));
      } while (this.matchValue(","));
    }
    const body = this.parseSelectBody({ ctes });
    while (this.atWord("union") || this.atWord("intersect") || this.atWord("except")) {
      this.next();
      this.matchWord("all");
      this.matchWord("distinct");
      const right = this.parseSelectBody({ ctes });
      for (const field of right.outputs) if (!body.outputs.some((f) => f.key === field.key)) body.outputs.push(field);
      for (const source of right.sources) if (!body.sources.includes(source)) body.sources.push(source);
    }
    return body;
  }

  private parseSelectBody(ctx: QueryContext): QueryBody {
    if (this.matchWord("table")) {
      const sources: SourceRef[] = [];
      this.parseSource(sources, ctx);
      const source = sources[0];
      if (source && source.kind !== "table") return { outputs: [...source.fields.values()], sources };
      this.warn(`TABLE ${source?.label ?? "?"}: columns unknown`);
      return { outputs: [], sources };
    }
    this.matchWord("select");
    this.matchWord("distinct");
    this.matchWord("all");
    const items = this.parseSelectItems();
    const sources: SourceRef[] = [];
    if (this.matchWord("from")) this.parseFrom(sources, ctx);
    const outputs = this.buildOutputs(items, sources);
    if (this.matchWord("where")) this.collectExpressionRefs(sources);
    if (this.matchWord("group")) { this.matchWord("by"); this.collectExpressionRefs(sources, outputs); }
    if (this.matchWord("having")) this.collectExpressionRefs(sources);
    if (this.matchWord("order")) { this.matchWord("by"); this.collectExpressionRefs(sources, outputs); }
    if (this.matchWord("limit")) this.collectExpressionRefs(sources);
    if (this.matchWord("offset")) this.collectExpressionRefs(sources);
    if (this.matchWord("fetch")) this.collectExpressionRefs(sources);
    return { outputs, sources };
  }

  private parseSelectItems(): SelectItem[] {
    const items: SelectItem[] = [];
    let depth = 0;
    let start = this.pos;
    while (!this.eof()) {
      const token = this.current();
      if (!token) break;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      if (depth === 0 && token.kind === "word" && (token.value === "from" || STATEMENT_STARTS.has(token.value))) break;
      if (depth === 0 && token.value === ",") {
        items.push(this.buildItem(start, this.pos));
        start = this.pos + 1;
      }
      this.next();
    }
    items.push(this.buildItem(start, this.pos));
    return items.filter((item) => item.tokens.length > 0);
  }

  private buildItem(start: number, end: number): SelectItem {
    const tokens = this.tokens.slice(start, end);
    if (tokens.length === 1 && tokens[0].value === "*") return { tokens, rendered: "*", star: true };
    if (tokens.length === 3 && tokens[0].value !== "." && tokens[1].value === "." && tokens[2].value === "*") {
      return { tokens, rendered: renderTokens(tokens), starSource: tokens[0].value };
    }
    let alias: string | undefined;
    let expressionEnd = tokens.length;
    let depth = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.value === "(") depth += 1;
      else if (token.value === ")") depth -= 1;
      else if (depth === 0 && token.kind === "word" && token.value === "as") {
        const next = tokens[i + 1];
        if (next && (next.kind === "word" || next.kind === "ident")) {
          alias = next.value;
          expressionEnd = i;
        }
        break;
      }
    }
    if (alias === undefined && tokens.length >= 2) {
      const last = tokens[tokens.length - 1];
      const prev = tokens[tokens.length - 2];
      if (last && (last.kind === "word" || last.kind === "ident") && !(last.kind === "word" && (KEYWORDS.has(last.value) || SQL_TYPE_MAP[last.value]))) {
        const chained = prev?.value === "." || (prev && prev.kind === "punct" && prev.value !== ")");
        if (!chained) { alias = last.value; expressionEnd = tokens.length - 1; }
      }
    }
    const expression = tokens.slice(0, expressionEnd);
    return { tokens: expression, rendered: renderTokens(expression), alias };
  }

  private buildOutputs(items: SelectItem[], sources: SourceRef[]): SchemaField[] {
    const fields: SchemaField[] = [];
    const keys = new Set<string>();
    const selectOrder = new Map<string, { start: number; keys: string[] }>();
    const register = (source: SourceRef, column: string) => {
      this.registerColumn(source, column);
      if (source.kind !== "table") return;
      const entry = selectOrder.get(source.model) ?? { start: source.fieldStart, keys: [] };
      entry.start = Math.min(entry.start, source.fieldStart);
      if (!entry.keys.includes(column)) entry.keys.push(column);
      selectOrder.set(source.model, entry);
    };
    const push = (field: SchemaField) => {
      const key = uniqueKey(field.key, keys);
      keys.add(key);
      fields.push(key === field.key ? field : { ...field, key });
    };
    let index = 0;
    for (const item of items) {
      index += 1;
      if (item.star || item.starSource) {
        const source = item.starSource
          ? sources.find((candidate) => candidate.key === item.starSource)
          : sources.length === 1 ? sources[0] : undefined;
        if (source && source.kind !== "table" && source.fields.size > 0) {
          for (const field of source.fields.values()) push({ ...field });
          continue;
        }
        this.warn(item.starSource
          ? `columns for ${item.starSource}.* are unknown`
          : `select *${source ? ` from ${source.label}` : ""}: columns unknown`);
        push({ key: "*", type: "text" });
        continue;
      }
      for (const ref of this.columnRefsIn(item.tokens)) {
        const resolved = this.resolveRef(ref, sources);
        if (resolved) register(resolved.source, resolved.column);
      }
      const single = this.singleColumnRef(item.tokens);
      const field: SchemaField = {
        key: item.alias ?? (single ? single.column : sanitizeKey(item.rendered, `col_${index}`)),
        type: this.inferType(item.tokens),
      };
      if (!single) field.derived = true;
      if (item.rendered && item.rendered !== field.key) field.expression = item.rendered;
      push(field);
    }
    // Select-list columns lead the base table's field list from where the
    // query first saw it; join/where-only columns follow in discovery order.
    for (const [modelName, entry] of selectOrder) {
      const target = this.models.get(modelName);
      if (!target) continue;
      const head = target.fields.slice(0, entry.start);
      const tail = target.fields.slice(entry.start);
      const frontKeys = new Set(entry.keys);
      const front = entry.keys.map((key) => tail.find((candidate) => candidate.key === key)).filter((candidate): candidate is SchemaField => Boolean(candidate));
      target.fields = [...head, ...front, ...tail.filter((candidate) => !frontKeys.has(candidate.key))];
    }
    return fields;
  }

  // ── FROM / joins ──────────────────────────────────────────────────────────

  private parseFrom(sources: SourceRef[], ctx: QueryContext): void {
    this.parseSource(sources, ctx);
    while (!this.eof()) {
      if (this.matchValue(",")) { this.parseSource(sources, ctx); continue; }
      if (!this.matchJoinIntro()) break;
      const leftIndex = sources.length - 1;
      this.parseSource(sources, ctx);
      if (this.matchWord("on")) {
        this.collectJoinConditions(sources);
      } else if (this.matchWord("using")) {
        const columns = this.takeParenGroup()
          .filter((token) => token.kind === "word" || token.kind === "ident")
          .map((token) => token.value);
        const left = sources[leftIndex];
        const right = sources[leftIndex + 1];
        if (left && right) {
          for (const column of columns) this.addJoinRelation({ source: left, column }, { source: right, column }, undefined);
        }
      }
    }
  }

  private parseSource(sources: SourceRef[], ctx: QueryContext): void {
    if (this.matchValue("(")) {
      const bodyStart = this.pos;
      const body = this.parseQuery(ctx);
      const bodyEnd = this.pos;
      this.matchValue(")");
      const alias = this.parseOptionalAlias();
      if (this.atValue("(")) this.takeParenGroup(); // subquery column aliases
      const base = alias?.value ?? `subquery_${++this.subquerySeq}`;
      const model = this.createDerived(base, undefined, body.outputs, "subquery", this.textBetween(bodyStart, bodyEnd));
      this.addLineage(model.name, body.sources);
      sources.push(this.sourceRef(base, alias?.label ?? base, model.name, "subquery", body.outputs));
      return;
    }
    const start = this.pos;
    const parts = this.parseQualifiedName();
    if (parts.length === 0) { this.warn("could not read a FROM source"); return; }
    const name = parts.map((part) => part.value).join(".");
    if (this.atValue("(")) {
      // Table function (`unnest(...)`, `values`, ...) — a derived source whose
      // columns come from its alias list when it has one.
      const args = this.takeParenGroup();
      for (const ref of this.columnRefsIn(args)) {
        const resolved = this.resolveRef(ref, sources);
        if (resolved) this.registerColumn(resolved.source, resolved.column);
      }
      const alias = this.parseOptionalAlias();
      const columnAliases = this.atValue("(") ? this.takeParenGroup() : [];
      const outputs = columnAliases
        .filter((token) => token.kind === "word" || token.kind === "ident")
        .map((token): SchemaField => ({ key: token.value, type: "text" }));
      const base = alias?.value ?? name;
      const model = this.createDerived(base, undefined, outputs, "subquery", this.textBetween(start, this.pos));
      sources.push(this.sourceRef(base, alias?.label ?? base, model.name, "subquery", outputs));
      return;
    }
    const alias = this.parseOptionalAlias();
    if (this.atValue("(")) this.takeParenGroup(); // column aliases after an alias
    const cte = ctx.ctes.get(name);
    if (cte) {
      sources.push({ ...cte, key: alias?.value ?? cte.key, label: alias?.label ?? cte.label });
      return;
    }
    if (this.refNames.has(name)) {
      // A dbt model referenced by `{{ ref(...) }}` — reuse its node when the
      // model is part of this import, otherwise draw an opaque model node.
      const model = this.ensureRefModel(name);
      const key = alias?.value ?? name;
      const source = this.sourceRef(key, alias?.label ?? name, model.name, "cte", model.fields);
      if (model.fields.length === 0) source.opaque = true;
      sources.push(source);
      return;
    }
    const model = this.ensureTableModel(name);
    sources.push({ key: alias?.value ?? name, label: alias?.label ?? name, model: model.name, kind: "table", fields: new Map(), fieldStart: model.fields.length });
  }

  private collectJoinConditions(sources: SourceRef[]): void {
    const expression = this.consumeExpression();
    for (const ref of this.columnRefsIn(expression)) {
      const resolved = this.resolveRef(ref, sources);
      if (resolved) this.registerColumn(resolved.source, resolved.column);
    }
    for (const conjunct of splitConjuncts(expression)) {
      const flat = stripOuterParens(conjunct);
      const equals = findTopLevelEquals(flat);
      if (equals < 0) continue;
      const leftRefs = this.columnRefsIn(flat.slice(0, equals));
      const rightRefs = this.columnRefsIn(flat.slice(equals + 1));
      if (leftRefs.length !== 1 || rightRefs.length !== 1) continue;
      const left = this.resolveRef(leftRefs[0], sources);
      const right = this.resolveRef(rightRefs[0], sources);
      if (left && right) this.addJoinRelation(left, right, renderTokens(flat));
    }
  }

  private collectExpressionRefs(sources: SourceRef[], outputs: SchemaField[] = []): void {
    const aliases = new Set(outputs.map((field) => field.key));
    for (const ref of this.columnRefsIn(this.consumeExpression())) {
      // `group by`/`order by` may name a select-list alias rather than a source column.
      if (!ref.qualifier && aliases.has(ref.column)) continue;
      const resolved = this.resolveRef(ref, sources);
      if (resolved) this.registerColumn(resolved.source, resolved.column);
    }
  }

  // ── token helpers ─────────────────────────────────────────────────────────

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eof(): boolean {
    return this.pos >= this.tokens.length;
  }

  private next(): Token | undefined {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  private peekToken(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private atValue(value: string): boolean {
    return this.current()?.value === value;
  }

  private atWord(word: string): boolean {
    const token = this.current();
    return token?.kind === "word" && token.value === word;
  }

  private matchValue(value: string): boolean {
    if (!this.atValue(value)) return false;
    this.pos += 1;
    return true;
  }

  private matchWord(word: string): boolean {
    if (!this.atWord(word)) return false;
    this.pos += 1;
    return true;
  }

  private matchJoinIntro(): boolean {
    const token = this.current();
    if (token?.kind !== "word") return false;
    if (token.value === "join") { this.next(); return true; }
    if (!["inner", "left", "right", "full", "cross", "natural"].includes(token.value)) return false;
    const next = this.peekToken(1)?.value;
    const after = this.peekToken(2)?.value;
    if (next === "join") { this.pos += 2; return true; }
    if (next === "outer" && after === "join") { this.pos += 3; return true; }
    return false;
  }

  private atJoinBoundary(): boolean {
    const token = this.current();
    if (token?.kind !== "word") return false;
    if (token.value === "join") return true;
    if (!["inner", "left", "right", "full", "cross", "natural"].includes(token.value)) return false;
    const next = this.peekToken(1)?.value;
    const after = this.peekToken(2)?.value;
    return next === "join" || (next === "outer" && after === "join");
  }

  private expectIdentifier(): Token | undefined {
    const token = this.current();
    if (!token || (token.kind !== "word" && token.kind !== "ident")) return undefined;
    this.next();
    return token;
  }

  private parseQualifiedName(): Token[] {
    const first = this.current();
    if (!first || (first.kind !== "word" && first.kind !== "ident")) return [];
    const parts: Token[] = [first];
    this.next();
    while (this.atValue(".") && (this.peekToken(1)?.kind === "word" || this.peekToken(1)?.kind === "ident")) {
      this.next();
      const part = this.next();
      if (part) parts.push(part);
    }
    return parts;
  }

  private parseOptionalAlias(): { value: string; label: string } | undefined {
    if (this.matchWord("as")) {
      const token = this.next();
      if (token && (token.kind === "word" || token.kind === "ident")) return { value: token.value, label: token.value };
      return undefined;
    }
    const token = this.current();
    if (!token || (token.kind !== "word" && token.kind !== "ident")) return undefined;
    if (token.kind === "word" && (KEYWORDS.has(token.value) || CLAUSE_STOP.has(token.value))) return undefined;
    this.next();
    return { value: token.value, label: token.value };
  }

  private takeParenGroup(): Token[] {
    if (!this.matchValue("(")) return [];
    const start = this.pos;
    let depth = 1;
    while (!this.eof()) {
      const token = this.current();
      if (!token) break;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") { depth -= 1; if (depth === 0) break; }
      this.next();
    }
    const inner = this.tokens.slice(start, this.pos);
    this.matchValue(")");
    return inner;
  }

  /** Consume an expression up to the next clause/join keyword at paren depth 0. */
  private consumeExpression(): Token[] {
    const start = this.pos;
    let depth = 0;
    while (!this.eof()) {
      const token = this.current();
      if (!token) break;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") { if (depth === 0) break; depth -= 1; }
      else if (depth === 0 && ((token.kind === "word" && (CLAUSE_STOP.has(token.value) || STATEMENT_STARTS.has(token.value))) || this.atJoinBoundary())) break;
      this.next();
    }
    return this.tokens.slice(start, this.pos);
  }

  private textBetween(start: number, end: number): string {
    if (end <= start) return "";
    const first = this.tokens[start];
    const last = this.tokens[end - 1];
    if (!first || !last) return "";
    return this.source.slice(first.start, last.end).trim();
  }

  // ── resolution / inference ────────────────────────────────────────────────

  private columnRefsIn(tokens: Token[]): ColumnRef[] {
    const refs: ColumnRef[] = [];
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token.value === "(" && (tokens[i + 1]?.value === "select" || tokens[i + 1]?.value === "with")) {
        i = skipParens(tokens, i);
        continue;
      }
      // `cast(expr as type)` / `try_cast(...)`: walk the expression, skip the type.
      if ((token.value === "cast" || token.value === "try_cast") && tokens[i + 1]?.value === "(") {
        const close = skipParens(tokens, i + 1);
        const inner = tokens.slice(i + 2, Math.max(i + 2, close - 1));
        const asIndex = findTopLevelWord(inner, "as");
        refs.push(...this.columnRefsIn(asIndex >= 0 ? inner.slice(0, asIndex) : inner));
        i = close;
        continue;
      }
      // `expr::type` — skip the type that follows.
      if (token.value === "::") {
        i = skipTypeTokens(tokens, i + 1);
        continue;
      }
      // `date '2024-01-01'` — a typed literal, not a column named `date`.
      if (token.kind === "word" && SQL_TYPE_MAP[token.value] && tokens[i + 1]?.kind === "string") {
        i += 2;
        continue;
      }
      // `at time zone 'UTC'`
      if (token.value === "time" && tokens[i + 1]?.value === "zone") {
        i += 2;
        continue;
      }
      if ((token.kind === "word" || token.kind === "ident") && !(token.kind === "word" && KEYWORDS.has(token.value))) {
        const parts = [token.value];
        let j = i + 1;
        while (j + 1 < tokens.length && tokens[j].value === "." && (tokens[j + 1].kind === "word" || tokens[j + 1].kind === "ident")) {
          parts.push(tokens[j + 1].value);
          j += 2;
        }
        if (tokens[j]?.value === "(") { i = j + 1; continue; } // function call — walk its arguments
        if (tokens[j]?.value === ".") { i = j + 1; continue; } // `alias.*`
        refs.push({ qualifier: parts.length > 1 ? parts.slice(0, -1).join(".") : undefined, column: parts[parts.length - 1] });
        i = j;
        continue;
      }
      i += 1;
    }
    return refs;
  }

  private singleColumnRef(tokens: Token[]): ColumnRef | undefined {
    const first = tokens[0];
    if (!first || (first.kind !== "word" && first.kind !== "ident")) return undefined;
    if (first.kind === "word" && KEYWORDS.has(first.value)) return undefined;
    const parts = [first.value];
    let i = 1;
    while (i + 1 < tokens.length && tokens[i].value === "." && (tokens[i + 1].kind === "word" || tokens[i + 1].kind === "ident")) {
      parts.push(tokens[i + 1].value);
      i += 2;
    }
    if (i !== tokens.length) return undefined;
    return { qualifier: parts.length > 1 ? parts.slice(0, -1).join(".") : undefined, column: parts[parts.length - 1] };
  }

  private resolveRef(ref: ColumnRef, sources: SourceRef[]): { source: SourceRef; column: string } | undefined {
    if (ref.qualifier) {
      const source = sources.find((candidate) => candidate.key === ref.qualifier);
      if (!source) { this.warn(`unknown table alias "${ref.qualifier}"`); return undefined; }
      return { source, column: ref.column };
    }
    if (sources.length === 1) return { source: sources[0], column: ref.column };
    const derived = sources.filter((source) => source.kind !== "table" && source.fields.has(ref.column));
    if (derived.length === 1) return { source: derived[0], column: ref.column };
    const opaque = sources.filter((source) => source.opaque);
    if (opaque.length === 1) return { source: opaque[0], column: ref.column };
    const tables = sources.filter((source) => source.kind === "table");
    if (tables.length === 1) return { source: tables[0], column: ref.column };
    this.warn(`ambiguous column "${ref.column}"`);
    return undefined;
  }

  private registerColumn(source: SourceRef, column: string): void {
    if (source.kind === "table") {
      const model = this.models.get(source.model);
      if (!model) return;
      if (!model.fields.some((field) => field.key === column)) model.fields.push({ key: column, type: "text" });
      return;
    }
    if (source.opaque || source.fields.has(column)) return;
    this.warn(`column "${column}" not found on "${source.label}"`);
  }

  private inferType(tokens: Token[]): FieldDataType {
    const expr = stripOuterParens(tokens);
    if (expr.length === 0) return "text";
    const cast = castTargetType(expr);
    if (cast) return sqlTypeToFieldType(cast);
    const castIndex = expr.findIndex((token) => token.value === "::");
    if (castIndex >= 0) return sqlTypeToFieldType(renderTokens(expr.slice(castIndex + 1)));
    if (expr[0]?.kind === "word" && expr.length === 2 && expr[1]?.kind === "string") {
      if (expr[0].value === "date") return "date";
      if (expr[0].value === "timestamp") return "datetime";
    }
    if (expr.length === 1) {
      const only = expr[0];
      if (only.kind === "number") return "number";
      if (only.value === "true" || only.value === "false") return "boolean";
      if (only.value === "current_date") return "date";
      if (only.value === "current_timestamp" || only.value === "current_time" || only.value === "localtime" || only.value === "localtimestamp") return "datetime";
      return "text";
    }
    if (expr[0]?.kind === "word" && expr[1]?.value === "(") {
      const fn = expr[0].value;
      return FUNCTION_TYPES[fn] ?? "text";
    }
    if (expr.some((token) => token.kind === "punct" && ["+", "-", "*", "/", "%"].includes(token.value))) return "number";
    return "text";
  }

  // ── graph building ────────────────────────────────────────────────────────

  private ensureTableModel(name: string): SchemaModel {
    const existing = this.models.get(name);
    if (existing) return existing;
    const model: SchemaModel = { name, fields: [] };
    this.models.set(name, model);
    return model;
  }

  /** A dbt model referenced by `{{ ref(...) }}`; filled in when its own statement is parsed. */
  private ensureRefModel(name: string): SchemaModel {
    const existing = this.models.get(name);
    if (existing) return existing;
    const model: SchemaModel = { name, kind: "query", fields: [] };
    this.models.set(name, model);
    this.placeholders.add(name);
    return model;
  }

  private createDerived(base: string, label: string | undefined, outputs: SchemaField[], kind: SchemaModelKind, sql: string): SchemaModel {
    const placeholder = this.placeholders.has(base) ? this.models.get(base) : undefined;
    if (placeholder) {
      this.placeholders.delete(base);
      placeholder.fields = outputs;
      placeholder.kind = kind;
      if (sql) placeholder.sql = sql;
      if (label) placeholder.label = label;
      return placeholder;
    }
    const name = this.uniqueName(base);
    const model: SchemaModel = { name, fields: outputs, kind, ...(sql ? { sql } : {}) };
    if (label) model.label = label;
    this.models.set(name, model);
    return model;
  }

  private uniqueName(base: string): string {
    let name = base;
    let suffix = 2;
    while (this.models.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    return name;
  }

  private sourceRef(key: string, label: string, model: string, kind: SourceKind, outputs: SchemaField[]): SourceRef {
    return { key, label, model, kind, fields: new Map(outputs.map((field) => [field.key, field])), fieldStart: 0 };
  }

  private addLineage(modelName: string, sources: SourceRef[]): void {
    const seen = new Set<string>();
    for (const source of sources) {
      if (source.model === modelName || seen.has(source.model)) continue;
      seen.add(source.model);
      this.addRelation({ fromModel: source.model, fromField: "", toModel: modelName, toField: "", kind: "lineage" });
    }
  }

  private addJoinRelation(from: { source: SourceRef; column: string }, to: { source: SourceRef; column: string }, label: string | undefined): void {
    if (from.source.model === to.source.model && from.column === to.column) return;
    this.addRelation({
      fromModel: from.source.model,
      fromField: from.column,
      toModel: to.source.model,
      toField: to.column,
      kind: "join",
      ...(label ? { label } : {}),
    });
  }

  private addRelation(relation: Omit<SchemaRelation, "id">): void {
    const id = relationEdgeId(relation.fromModel, relation.fromField, relation.toModel, relation.toField, relation.kind);
    if (this.relationIds.has(id)) return;
    this.relationIds.add(id);
    this.relations.push({ id, ...relation });
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.warnings.push(message);
  }
}

function skipParens(tokens: Token[], start: number): number {
  let depth = 0;
  let i = start;
  while (i < tokens.length) {
    const value = tokens[i].value;
    if (value === "(") depth += 1;
    else if (value === ")") { depth -= 1; if (depth === 0) return i + 1; }
    i += 1;
  }
  return i;
}

/** Index of the first `word` at paren depth 0, or -1. */
function findTopLevelWord(tokens: Token[], word: string): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.value === "(") depth += 1;
    else if (token.value === ")") depth -= 1;
    else if (depth === 0 && token.kind === "word" && token.value === word) return i;
  }
  return -1;
}

/** Skip the SQL type that follows a `::` cast. */
function skipTypeTokens(tokens: Token[], start: number): number {
  const first = tokens[start];
  if (!first || (first.kind !== "word" && first.kind !== "ident")) return start;
  let i = start + 1;
  if (tokens[i]?.value === "(") i = skipParens(tokens, i);
  if ((tokens[i]?.value === "with" || tokens[i]?.value === "without") && tokens[i + 1]?.value === "time" && tokens[i + 2]?.value === "zone") i += 3;
  return i;
}

function uniqueKey(key: string, keys: Set<string>): string {
  if (!keys.has(key)) return key;
  let suffix = 2;
  while (keys.has(`${key}_${suffix}`)) suffix += 1;
  return `${key}_${suffix}`;
}

function applyColumnAliases(outputs: SchemaField[], aliasTokens: Token[]): SchemaField[] {
  const names = aliasTokens.filter((token) => token.kind === "word" || token.kind === "ident").map((token) => token.value);
  if (names.length === 0) return outputs;
  return outputs.map((field, index) => (names[index] ? { ...field, key: names[index] } : field));
}
