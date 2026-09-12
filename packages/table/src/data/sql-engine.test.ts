import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildPredicate, type FilterNode } from "sheetbase-shared";
import { DATASET_COLUMNS, createDataset, filterTreeToSql, filtersToSql, insertRecord, sortToSql, type FieldScope, type SeededRow } from "../../examples/sql-engine";
import type { ConditionNode } from "sheetbase-shared";

// The example engine is bun-run (bun:sqlite); the suite is vitest/node —
// node:sqlite's DatabaseSync satisfies the same structural SqlDb contract.

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const oldDate = "2026-01-05";

const FIXTURE: SeededRow[] = [
  { recordId: "r1", values: { experiment_id: "EXP-1", sample_id: "SMP-1", assay: "BCA", result: 1.5, unit: "ng/mL", run_date: today, status: "Complete", reviewer: "Alice", approved: true } },
  { recordId: "r2", values: { experiment_id: "EXP-2", sample_id: "SMP-2", assay: "HCP", result: 2.5, unit: "Ct", run_date: yesterday, status: "Flagged", reviewer: null, approved: false } },
  { recordId: "r3", values: { experiment_id: "EXP-3", sample_id: "SMP-3", assay: "bca", result: null, unit: "ng/mL", run_date: oldDate, status: "Review", reviewer: "Bob", approved: true } },
  { recordId: "r4", values: { experiment_id: "EXP-4", sample_id: "SMP-4", assay: "PicoGreen", result: 10, unit: "Ct", run_date: "2020-01-01", status: "", reviewer: "Carol", approved: false } },
  { recordId: "r5", values: { experiment_id: "EXP-5", sample_id: "SMP-5", assay: null, result: 7, unit: "ng/mL", run_date: null, status: "Flagged", reviewer: "", approved: true } },
];

function db(rows: SeededRow[] = FIXTURE): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  createDataset(database, rows.length, (index) => rows[index] ?? { recordId: "unreached", values: {} });
  return database;
}

const cond = (field: string, operator: ConditionNode["operator"], value?: unknown): FilterNode =>
  ({ type: "condition", id: `c_${field}_${operator}`, field, operator, ...(value === undefined ? {} : { value }) });
const group = (combinator: "AND" | "OR" | "NOT", children: FilterNode[]): FilterNode =>
  ({ type: "group", id: "g", combinator, children });

/** Row ids the SQL engine returns for a tree — and the ids buildPredicate
 *  keeps on the same fixture. They must be identical. */
function expectParity(tree: FilterNode, rows: SeededRow[] = FIXTURE, known?: FieldScope) {
  const database = db(rows);
  const compiled = filterTreeToSql(tree, known);
  const sqlIds = database.prepare(`SELECT record_id FROM records WHERE ${compiled.sql}`).all(...compiled.params).map((row) => row.record_id).sort();
  const jsIds = rows.filter((row) => buildPredicate(tree)(row.values)).map((row) => row.recordId).sort();
  expect({ sql: compiled.sql, ids: sqlIds }).toEqual({ sql: compiled.sql, ids: jsIds });
}

describe("filterTreeToSql parity with buildPredicate", () => {
  it("eq matches case-insensitively and via numeric affinity", () => {
    expectParity(cond("assay", "eq", "bca"));            // BCA + bca
    expectParity(cond("result", "eq", 1.5));
    expectParity(cond("result", "eq", "1.5"));          // numeric text
    expectParity(cond("status", "eq", "Complete"));
  });

  it("eq '' and eq null match null/empty, neq keeps or drops exactly", () => {
    expectParity(cond("status", "eq", ""));
    expectParity(cond("reviewer", "eq", null));
    expectParity(cond("reviewer", "neq", "Alice"));     // null reviewer kept
    expectParity(cond("reviewer", "neq", ""));          // null reviewer dropped
    expectParity(cond("status", "neq", "Flagged"));     // '' status kept
  });

  it("eq true/false match the approved 0/1 column like looseEqual", () => {
    expectParity(cond("approved", "eq", true));
    expectParity(cond("approved", "eq", false));
  });

  it("ordering operators compare numbers and dates by kind", () => {
    expectParity(cond("result", "gt", 2));
    expectParity(cond("result", "gte", 2.5));
    expectParity(cond("result", "lt", 2));
    expectParity(cond("run_date", "gte", yesterday));
    expectParity(cond("status", "gt", "abc"));          // incomparable → nothing
  });

  it("isNull/notNull match null or whitespace-only (the predicate trims)", () => {
    expectParity(cond("assay", "isNull"));
    expectParity(cond("assay", "notNull"));
    expectParity(cond("reviewer", "isNull"));           // null + ''
  });

  it("contains/startsWith/endsWith are case-insensitive literal matches", () => {
    expectParity(cond("assay", "contains", "CA"));
    expectParity(cond("sample_id", "startsWith", "smp"));
    expectParity(cond("experiment_id", "endsWith", "5"));
    expectParity(cond("assay", "contains", ""));        // matches everything incl nulls
    expectParity(cond("assay", "contains", "P%"));      // % is literal, not a wildcard
  });

  it("in is looseEqual per element; empty array matches nothing", () => {
    expectParity(cond("status", "in", ["Complete", "flagged"]));
    expectParity(cond("status", "in", []));
    expectParity(cond("result", "in", [1.5, "7"]));
  });

  it("between is inclusive and normalises reversed bounds", () => {
    expectParity(cond("result", "between", [1.5, 2.5]));
    expectParity(cond("result", "between", [2.5, 1.5]));
    expectParity(cond("run_date", "between", [oldDate, yesterday]));
    expectParity(cond("result", "between", ["a", "b"]));  // invalid → nothing
  });

  it("withinLastDays is calendar days inclusive of today", () => {
    expectParity(cond("run_date", "withinLastDays", 1));  // today only
    expectParity(cond("run_date", "withinLastDays", 2));  // today + yesterday
    expectParity(cond("run_date", "withinLastDays", 0));  // nothing
  });

  it("NOT is NOR — no child may match", () => {
    expectParity(group("NOT", [cond("status", "eq", "Flagged"), cond("status", "eq", "Complete")]));
    expectParity(group("NOT", [cond("result", "gt", 1)]));  // null result rows kept (NOR)
  });

  it("nested groups compose", () => {
    expectParity(group("AND", [
      cond("unit", "eq", "ng/mL"),
      group("OR", [cond("status", "eq", "Complete"), cond("approved", "eq", true)]),
      group("NOT", [cond("reviewer", "eq", "Alice")]),
    ]));
    expectParity(group("OR", []));                        // empty OR: nothing
    expectParity(group("NOT", []));                       // empty NOT: everything
  });

  it("quotes hostile identifiers", () => {
    const database = new DatabaseSync(":memory:");
    database.exec('CREATE TABLE t (record_id TEXT PRIMARY KEY, "we""ird" TEXT)');
    database.prepare('INSERT INTO t (record_id, "we""ird") VALUES (?, ?)').run("x1", "yes");
    const compiled = filterTreeToSql(cond('we"ird', "eq", "yes"));
    expect(compiled.sql).toContain('"we""ird"');
    expect(database.prepare(`SELECT record_id FROM t WHERE ${compiled.sql}`).all(...compiled.params)).toHaveLength(1);
  });
});

const KNOWN: FieldScope = new Set(DATASET_COLUMNS);

describe("FieldScope — unknown fields read as NULL", () => {
  // The fixture rows carry no 'material' field, so buildPredicate's cell()
  // returns undefined for it — the same null semantics the NULL literal gives SQL.
  it("matches buildPredicate's missing-cell semantics per operator", () => {
    expectParity(cond("material", "eq", "steel"), FIXTURE, KNOWN);       // none
    expectParity(cond("material", "neq", "steel"), FIXTURE, KNOWN);      // all
    expectParity(cond("material", "eq", ""), FIXTURE, KNOWN);            // all — asText(undefined) === ''
    expectParity(cond("material", "neq", ""), FIXTURE, KNOWN);           // none
    expectParity(cond("material", "isNull"), FIXTURE, KNOWN);            // all
    expectParity(cond("material", "notNull"), FIXTURE, KNOWN);           // none
    expectParity(cond("material", "contains", "x"), FIXTURE, KNOWN);     // none
    expectParity(cond("material", "contains", ""), FIXTURE, KNOWN);      // all
    expectParity(cond("material", "startsWith", "x"), FIXTURE, KNOWN);   // none
    expectParity(cond("material", "endsWith", "x"), FIXTURE, KNOWN);     // none
    expectParity(cond("material", "in", ["a", "b"]), FIXTURE, KNOWN);    // none
    expectParity(cond("material", "in", ["", "x"]), FIXTURE, KNOWN);     // all — the '' arm matches
    expectParity(cond("material", "gt", 1), FIXTURE, KNOWN);             // none
    expectParity(cond("material", "between", [1, 5]), FIXTURE, KNOWN);   // none
    expectParity(cond("material", "withinLastDays", 5), FIXTURE, KNOWN); // none
    expectParity(cond("material", "eq", true), FIXTURE, KNOWN);          // none
  });

  it("composes with known fields inside trees", () => {
    expectParity(group("AND", [cond("status", "eq", "Flagged"), cond("material", "neq", "x")]), FIXTURE, KNOWN);
    expectParity(group("NOT", [cond("material", "eq", "x")]), FIXTURE, KNOWN);
    expectParity(group("OR", [cond("material", "eq", "x"), cond("assay", "eq", "BCA")]), FIXTURE, KNOWN);
  });

  it("never emits the unknown identifier — no 'no such column'", () => {
    const database = db();
    const where = filterTreeToSql(cond("material", "eq", "steel"), KNOWN);
    expect(where.sql).not.toContain('"material"');
    expect(() => database.prepare(`SELECT record_id FROM records WHERE ${where.sql}`).all(...where.params)).not.toThrow();
    const flat = filtersToSql([{ fieldId: "material", operator: "eq", value: "steel" }], "and", KNOWN);
    expect(flat.sql).not.toContain('"material"');
    expect(() => database.prepare(`SELECT record_id FROM records WHERE ${flat.sql}`).all(...flat.params)).not.toThrow();
    const order = sortToSql([{ fieldId: "material", direction: "asc" }], KNOWN);
    expect(order).not.toContain('"material"');
    expect(() => database.prepare(`SELECT record_id FROM records ORDER BY ${order}`).all()).not.toThrow();
  });

  it("keeps trusting callers without a scope (no whitelist supplied)", () => {
    const compiled = filterTreeToSql(cond('we"ird', "eq", "yes"));
    expect(compiled.sql).toContain('"we""ird"');
  });
});

describe("createDataset/insertRecord", () => {
  it("round-trips values including nulls and booleans", () => {
    const database = db();
    const row = database.prepare("SELECT * FROM records WHERE record_id = 'r2'").get();
    expect(row?.status).toBe("Flagged");
    expect(row?.reviewer).toBeNull();
    expect(row?.approved).toBe(0);
    insertRecord(database, "r9", { assay: "new", approved: true, result: 3 });
    const created = database.prepare("SELECT * FROM records WHERE record_id = 'r9'").get();
    expect(created?.approved).toBe(1);
    expect(created?.result).toBe(3);
    expect(created?.status).toBeNull();
  });
});
