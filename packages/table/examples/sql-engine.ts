import type { ConditionNode, FilterNode, GroupNode } from "sheetbase-shared";

/**
 * `filterTree` → parameterised SQL — the reference host-executor
 * implementation the shared README promises. `buildPredicate` (in
 * packages/shared/src/predicate.ts + tree.ts) is the canonical semantics;
 * this compiler mirrors them in portable SQLite:
 *
 * - AND = every child, OR = any child, NOT = NOR (no child matches).
 * - `eq`/`neq`/`in` mirror `looseEqual`, which is tri-mode: booleans match
 *   the true/yes/1 · false/no/0 text sets, numbers match numeric text
 *   (including comma-grouped), date-shaped strings match by parsed date,
 *   everything else compares as case-insensitive text. The compiler reads
 *   the expected value's JS type and emits the matching arm — that is the
 *   same dispatch `looseEqual` performs.
 * - Null semantics are exact: `eq null`/`eq ''` match NULL (looseEqual's
 *   text fallback compares asText(null) === ''), `neq` keeps NULL rows
 *   unless the expected value is ''/null, `isNull` matches NULL or
 *   whitespace-only text (the predicate trims), and every condition under
 *   a NOT is COALESCEd so a NULL expression result can't flip NOR.
 * - `between` bounds normalise like the predicate (reversed bounds work;
 *   mixed/invalid kinds match nothing → `0=1`). `withinLastDays` computes
 *   its [start, today] window in JS at compile time — the same code path
 *   as the predicate — and binds it as ISO-text params.
 *
 * Documented residual divergences (typed columns make them rare in
 * practice): CAST() parses numeric prefixes so pathological strings like
 * '5e' or 'e5' can diverge from JS Number(); date ordering compares ISO
 * text lexically, which is chronological for uniform ISO-8601 but not for
 * mixed formats; and `cell()`'s case-insensitive field lookup has no SQL
 * equivalent (columns are fixed names). The `/api/table/pages?engine=
 * compare` mode is the arbiter — it runs both implementations on the same
 * request and reports divergent row sets.
 */

export type SqlParam = string | number | null;

/** The minimal db surface both bun:sqlite's Database and node:sqlite's DatabaseSync satisfy. */
export interface SqlDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: SqlParam[]): unknown;
    all(...params: SqlParam[]): Record<string, unknown>[];
    get(...params: SqlParam[]): Record<string, unknown> | undefined;
  };
}

export type SeededRow = { recordId: string; values: Record<string, string | number | boolean | null> };

/** Column order of the `records` table — also the whitelist for fieldIds
 *  arriving over the wire (unknown ids project as NULL, matching the
 *  memory engine's `?? null`). */
export const DATASET_COLUMNS = ["experiment_id", "sample_id", "assay", "result", "unit", "run_date", "status", "reviewer", "approved"] as const;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** looseEqual's numeric sniff: finite numbers, or text that trims to a
 *  digit-containing token built only of number characters (a '-' past the
 *  first character disqualifies — ISO dates like '2026-01-01' must not
 *  CAST to 2026). */
const numish = (f: string) =>
  `(typeof(${f}) IN ('integer','real') OR (typeof(${f}) = 'text' AND TRIM(${f}) GLOB '*[0-9]*' AND TRIM(${f}) NOT GLOB '*[^0-9.eE+-]*' AND TRIM(${f}) NOT GLOB '?*[-]*'))`;
const numExpr = (f: string) => `CAST(REPLACE(TRIM(CAST(${f} AS TEXT)), ',', '') AS REAL)`;
/** asDate's shape test: a separator and four consecutive digits. */
const dateish = (f: string) =>
  `(CAST(${f} AS TEXT) GLOB '*[0-9][0-9][0-9][0-9]*' AND CAST(${f} AS TEXT) GLOB '*[-/:]*')`;

/** Mirror of predicate's asNum for the *expected* value (compile-time). */
function expectedNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Mirror of predicate's asDate for the *expected* value (compile-time). */
function expectedDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return /[-/:]/.test(text) && /\d{4}/.test(text) && !Number.isNaN(Date.parse(text));
}

const escapeLike = (value: string) => value.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => `\\${m}`);

/** looseEqual for one expected value. Every term is NULL-safe so the whole
 *  expression can sit under NOT. */
function eqSql(field: string, value: unknown): { sql: string; params: SqlParam[] } {
  // looseEqual(null-expected): only the text fallback survives — matches
  // actual null/undefined/'' (untrimmed — isNull is the trimming variant).
  if (value === null || value === undefined || value === "") {
    return { sql: `(${field} IS NULL OR CAST(${field} AS TEXT) = '')`, params: [] };
  }
  if (typeof value === "boolean") {
    const set = value ? "('true','yes','1')" : "('false','no','0')";
    const num = value ? 1 : 0;
    // Actual booleans persist as 0/1; a numeric actual joins through the
    // text cast exactly like looseEqual's asText path.
    return { sql: `(LOWER(CAST(${field} AS TEXT)) IN ${set} OR ${field} = ${num})`, params: [] };
  }
  const parts: string[] = [`COALESCE(LOWER(CAST(${field} AS TEXT)) = LOWER(?), 0)`];
  const params: SqlParam[] = [String(value)];
  const num = expectedNum(value);
  if (num !== null) {
    parts.push(`(${numish(field)} AND ${numExpr(field)} = ?)`);
    params.push(num);
  }
  if (expectedDate(value)) {
    // date() normalises formats the way Date.parse unifies instants;
    // unparseable actuals yield NULL → no match.
    parts.push(`COALESCE(date(${field}) = date(?), 0)`);
    params.push(String(value));
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

/** gt/gte/lt/lte: both sides must be comparable and of the same kind
 *  (asComparable). Non-numeric/non-date expecteds can never match. */
function orderingSql(field: string, operator: "gt" | "gte" | "lt" | "lte", value: unknown): { sql: string; params: SqlParam[] } {
  const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator];
  const num = expectedNum(value);
  if (num !== null) return { sql: `(${numish(field)} AND ${numExpr(field)} ${op} ?)`, params: [num] };
  if (expectedDate(value)) {
    // ISO text compares chronologically; date(f) IS NOT NULL rejects
    // malformed-but-separator-carrying junk that asDate would reject.
    return { sql: `(${dateish(field)} AND date(${field}) IS NOT NULL AND ${field} ${op} ?)`, params: [String(value)] };
  }
  return { sql: "(0=1)", params: [] };
}

function conditionSql(node: ConditionNode): { sql: string; params: SqlParam[] } {
  const f = quoteIdent(node.field);
  const value = node.value;
  switch (node.operator) {
    case "isNull":
      return { sql: `(${f} IS NULL OR TRIM(CAST(${f} AS TEXT)) = '')`, params: [] };
    case "notNull":
      return { sql: `(${f} IS NOT NULL AND TRIM(CAST(${f} AS TEXT)) <> '')`, params: [] };
    case "eq":
      return eqSql(f, value);
    case "neq": {
      // NULL actuals: looseEqual's text fallback makes neq keep them
      // unless the expected value is ''/null — the CASE encodes exactly that.
      const nullCase = value === null || value === undefined || value === "" ? "0" : "1";
      const eq = eqSql(f, value);
      return { sql: `(CASE WHEN ${f} IS NULL THEN ${nullCase} WHEN ${eq.sql} THEN 0 ELSE 1 END)`, params: eq.params };
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return orderingSql(f, node.operator, value);
    case "contains":
    case "startsWith":
    case "endsWith": {
      // asText(actual) always contains '' — including null actuals.
      if (value === null || value === undefined || value === "") return { sql: "(1=1)", params: [] };
      const text = escapeLike(String(value).toLowerCase());
      const pattern = node.operator === "contains" ? `%${text}%` : node.operator === "startsWith" ? `${text}%` : `%${text}`;
      return { sql: `LOWER(CAST(${f} AS TEXT)) LIKE ? ESCAPE '\\'`, params: [pattern] };
    }
    case "in": {
      // `in` is looseEqual per element — each gets its own typed arm.
      const values = Array.isArray(value) ? value : [];
      if (!values.length) return { sql: "(0=1)", params: [] };
      const arms = values.map((item) => eqSql(f, item));
      return { sql: `(${arms.map((arm) => arm.sql).join(" OR ")})`, params: arms.flatMap((arm) => arm.params) };
    }
    case "between": {
      const raw = Array.isArray(value) ? value : value && typeof value === "object" && "low" in value && "high" in value ? [(value as { low: unknown }).low, (value as { high: unknown }).high] : null;
      if (!raw) return { sql: "(0=1)", params: [] };
      const [lo, hi] = raw;
      const loNum = expectedNum(lo);
      const hiNum = expectedNum(hi);
      if (loNum !== null && hiNum !== null) {
        const [min, max] = [Math.min(loNum, hiNum), Math.max(loNum, hiNum)];
        return { sql: `(${numish(f)} AND ${numExpr(f)} BETWEEN ? AND ?)`, params: [min, max] };
      }
      if (expectedDate(lo) && expectedDate(hi)) {
        const [min, max] = Date.parse(String(lo)) <= Date.parse(String(hi)) ? [String(lo), String(hi)] : [String(hi), String(lo)];
        return { sql: `(${dateish(f)} AND date(${f}) IS NOT NULL AND ${f} BETWEEN ? AND ?)`, params: [min, max] };
      }
      return { sql: "(0=1)", params: [] }; // mixed/invalid kinds never match
    }
    case "withinLastDays": {
      const days = expectedNum(value);
      if (days === null || days <= 0) return { sql: "(0=1)", params: [] };
      // Same UTC calendar window the predicate computes: days inclusive of today.
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      return { sql: `(${dateish(f)} AND date(${f}) IS NOT NULL AND ${f} >= ? AND ${f} <= ?)`, params: [start, today] };
    }
    default:
      // Unknown operator: nothing matches — never silently pass rows.
      return { sql: "(0=1)", params: [] };
  }
}

function compile(node: FilterNode): { sql: string; params: SqlParam[] } {
  if (node.type === "condition") return conditionSql(node);
  const children = node.children.map(compile);
  if (node.combinator === "OR") {
    return { sql: children.length ? `(${children.map((c) => c.sql).join(" OR ")})` : "(0=1)", params: children.flatMap((c) => c.params) };
  }
  if (node.combinator === "NOT") {
    // NOR: no child may match. COALESCE keeps NULL results (unmatched
    // typed comparisons on NULL cells) from poisoning the negation.
    const inner = children.length ? children.map((c) => `COALESCE(${c.sql}, 0)`).join(" OR ") : "0";
    return { sql: `(NOT (${inner}))`, params: children.flatMap((c) => c.params) };
  }
  return { sql: children.length ? `(${children.map((c) => c.sql).join(" AND ")})` : "(1=1)", params: children.flatMap((c) => c.params) };
}

/** Compile a plan-008 filter tree to a parameterised WHERE clause
 *  (no leading WHERE keyword). */
export function filterTreeToSql(node: FilterNode): { sql: string; params: SqlParam[] } {
  return compile(node);
}

/** Compile flat `filters` + `filterLogic` as a single-level tree — the
 *  canonical (looseEqual) semantics, which are what the wire contract
 *  prescribes; the legacy in-file `matches` shim differs on null edges. */
export function filtersToSql(filters: readonly { fieldId: string; operator: string; value?: unknown }[], logic: "and" | "or"): { sql: string; params: SqlParam[] } {
  if (!filters.length) return { sql: "(1=1)", params: [] };
  const group: GroupNode = {
    type: "group",
    id: "flat",
    combinator: logic === "or" ? "OR" : "AND",
    children: filters.map((filter, index) => ({ type: "condition", id: `f${index}`, field: filter.fieldId, operator: filter.operator as ConditionNode["operator"], value: filter.value })),
  };
  return compile(group);
}

/** Sort clause → ORDER BY. Null ordering mirrors the in-file `compare`:
 *  nulls last ascending, first descending; `record_id` text breaks ties
 *  (localeCompare on these ids is byte order). With no sort the JS path
 *  keeps scan order — `rowid` is exactly that (insertion order), which a
 *  textual `record_id` sort would not be ('record-10' < 'record-2'). */
export function sortToSql(sort: readonly { fieldId: string; direction: "asc" | "desc" }[]): string {
  if (!sort.length) return "rowid";
  const parts = sort.map((clause) => {
    const f = quoteIdent(clause.fieldId);
    return clause.direction === "desc" ? `${f} IS NULL DESC, ${f} DESC` : `${f} IS NULL ASC, ${f} ASC`;
  });
  parts.push("record_id ASC");
  return parts.join(", ");
}

export function quoteField(name: string): string {
  return quoteIdent(name);
}

/** Insert one record; values beyond DATASET_COLUMNS are not persisted
 *  (the memory engine keeps them on created rows — a documented edge:
 *  SQL projects only real columns). Booleans land as 0/1. */
export function insertRecord(db: SqlDb, recordId: string, values: SeededRow["values"]): void {
  db.prepare(`INSERT INTO records (record_id, ${DATASET_COLUMNS.join(", ")}) VALUES (?, ${DATASET_COLUMNS.map(() => "?").join(", ")})`).run(
    recordId,
    ...DATASET_COLUMNS.map((column) => {
      const value = values[column];
      if (column === "approved") return value === "true" || value === true || value === 1 ? 1 : 0;
      if (column === "result") return value === null || value === undefined ? null : Number(value);
      return value === undefined || value === null ? null : typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number);
    }),
  );
}

/** Create + seed the reference table. `rowAt` shares the in-memory
 *  generator so the SQL and memory engines serve identical bytes. */
export function createDataset(db: SqlDb, rows: number, rowAt: (index: number) => SeededRow): void {
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    record_id TEXT PRIMARY KEY,
    experiment_id TEXT,
    sample_id TEXT,
    assay TEXT,
    result REAL,
    unit TEXT,
    run_date TEXT,
    status TEXT,
    reviewer TEXT,
    approved INTEGER
  )`);
  db.exec("BEGIN");
  try {
    for (let index = 0; index < rows; index++) insertRecord(db, rowAt(index).recordId, rowAt(index).values);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
