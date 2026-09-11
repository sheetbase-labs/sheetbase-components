import { describe, expect, it } from "vitest";
import { queryKey } from "./query";
import { filterRows, testCondition, toFilterClause } from "./predicate";
import { applySearch, buildPredicate, compileToDatasetQuery, groupRows } from "./tree";

const rows = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
];

describe("testCondition", () => {
  it("accepts table, explorer and rules clause shapes", () => {
    const table = toFilterClause({ fieldId: "amount", operator: "gt", value: 1000 })!;
    const explorer = toFilterClause({ field: "amount", operator: "between", value: "15", value2: "100" })!;
    const rules = toFilterClause({ field: "status", operator: "isEmpty" })!;
    expect(testCondition(rows[0]!, table)).toBe(true);
    expect(testCondition({ amount: 50 }, explorer)).toBe(true);
    expect(testCondition({ status: "" }, rules)).toBe(true);
    expect(toFilterClause({ field: "x", operator: "nope" })).toBeUndefined();
  });

  it("filters with AND/OR like the table query contract", () => {
    const clauses = [
      toFilterClause({ fieldId: "region", operator: "eq", value: "eu" })!,
      toFilterClause({ fieldId: "amount", operator: "gt", value: 1000 })!,
    ];
    expect(filterRows(rows, clauses, "and")).toHaveLength(1);
    expect(filterRows(rows, clauses, "or")).toHaveLength(2);
  });
});

describe("date comparisons", () => {
  const dated = [
    { id: "a", run_date: "2026-01-15" },
    { id: "b", run_date: "2026-03-01" },
    { id: "c", run_date: "2026-03-01T14:30:00Z" },
  ];

  it("compares ISO date strings with gt/lt/gte/lte", () => {
    expect(testCondition(dated[0]!, { fieldId: "run_date", operator: "gt", value: "2026-01-01" })).toBe(true);
    expect(testCondition(dated[0]!, { fieldId: "run_date", operator: "lt", value: "2026-01-01" })).toBe(false);
    expect(testCondition(dated[0]!, { fieldId: "run_date", operator: "gte", value: "2026-01-15" })).toBe(true);
    expect(testCondition(dated[0]!, { fieldId: "run_date", operator: "lte", value: "2026-01-14" })).toBe(false);
    expect(testCondition(dated[0]!, { fieldId: "run_date", operator: "gt", value: "2026-01-01" })).toBe(true);
  });

  it("matches dates between array and object bounds", () => {
    expect(filterRows(dated, [{ fieldId: "run_date", operator: "between", value: ["2026-01-01", "2026-02-01"] }])).toHaveLength(1);
    expect(filterRows(dated, [{ fieldId: "run_date", operator: "between", value: { low: "2026-02-01", high: "2026-04-01" } }])).toHaveLength(2);
  });

  it("treats a date cell as equal across representations", () => {
    expect(testCondition({ d: "2026-01-15" }, { fieldId: "d", operator: "eq", value: "2026-01-15T00:00:00.000Z" })).toBe(true);
    expect(testCondition({ d: new Date(Date.UTC(2026, 0, 15)) }, { fieldId: "d", operator: "eq", value: "2026-01-15" })).toBe(true);
    expect(testCondition({ d: "2026-01-15" }, { fieldId: "d", operator: "neq", value: "2026-01-16" })).toBe(true);
    expect(testCondition({ d: "2026-01-15" }, { fieldId: "d", operator: "eq", value: "2026-01-16" })).toBe(false);
  });

  it("keeps numeric comparisons numeric", () => {
    expect(testCondition({ n: 10 }, { fieldId: "n", operator: "gt", value: "5" })).toBe(true);
    expect(testCondition({ n: 10 }, { fieldId: "n", operator: "gt", value: "hello" })).toBe(false);
    expect(testCondition({ n: "10" }, { fieldId: "n", operator: "between", value: [5, 20] })).toBe(true);
    expect(testCondition({ n: 10 }, { fieldId: "n", operator: "lt", value: "2026-01-15" })).toBe(false);
    expect(testCondition({ n: "2026-01-15" }, { fieldId: "n", operator: "gt", value: 10 })).toBe(false);
  });

  it("does not reinterpret product codes as dates", () => {
    expect(testCondition({ code: "5-10" }, { fieldId: "code", operator: "gt", value: "5-2" })).toBe(false);
    expect(testCondition({ code: "5-10" }, { fieldId: "code", operator: "between", value: ["5-1", "5-20"] })).toBe(false);
  });

  it("withinLastDays uses calendar days inclusive of today", () => {
    const today = new Date().toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    expect(testCondition({ d: today }, { fieldId: "d", operator: "withinLastDays", value: 1 })).toBe(true);
    expect(testCondition({ d: threeDaysAgo }, { fieldId: "d", operator: "withinLastDays", value: 1 })).toBe(false);
    expect(testCondition({ d: threeDaysAgo }, { fieldId: "d", operator: "withinLastDays", value: 4 })).toBe(true);
    expect(testCondition({ d: "not a date" }, { fieldId: "d", operator: "withinLastDays", value: 7 })).toBe(false);
  });
});

describe("queryKey", () => {
  it("creates stable identities while preserving clause priority", () => {
    const first = queryKey({ sort: [{ fieldId: "date", direction: "desc" }], filters: [{ fieldId: "status", operator: "eq", value: "Complete" }] });
    const second = queryKey({ filters: [{ value: "Complete", operator: "eq", fieldId: "status" }], sort: [{ direction: "desc", fieldId: "date" }] });
    expect(first).toBe(second);
  });
});

describe("filter tree", () => {
  it("ANDs nested OR groups", () => {
    const fn = buildPredicate({
      type: "group", id: "g", combinator: "AND", children: [
        { type: "condition", id: "a", field: "region", operator: "eq", value: "eu" },
        {
          type: "group", id: "h", combinator: "OR", children: [
            { type: "condition", id: "b", field: "status", operator: "eq", value: "failed" },
            { type: "condition", id: "c", field: "status", operator: "eq", value: "blocked" },
          ],
        },
      ],
    });
    expect(rows.filter(fn)).toHaveLength(2);
  });

  it("NOT excludes rows matching any child (NOR)", () => {
    const fn = buildPredicate({
      type: "group", id: "g", combinator: "NOT", children: [
        { type: "condition", id: "a", field: "status", operator: "eq", value: "ok" },
        { type: "condition", id: "b", field: "region", operator: "eq", value: "eu" },
      ],
    });
    expect(fn({ status: "ok", region: "us" })).toBe(false);
    expect(fn({ status: "failed", region: "eu" })).toBe(false);
    expect(fn({ status: "pending", region: "apac" })).toBe(true);
  });

  it("an empty NOT group matches everything", () => {
    const fn = buildPredicate({ type: "group", id: "g", combinator: "NOT", children: [] });
    expect(rows.filter(fn)).toHaveLength(3);
  });

  it("sorts and limits after filtering", () => {
    const spec = {
      filter: { type: "group" as const, id: "g", combinator: "AND" as const, children: [] },
      sort: { field: "amount", direction: "desc" as const },
      limit: 2,
    };
    expect(applySearch(rows, spec).map((r) => r.amount)).toEqual([6000, 100]);
  });

  it("buckets by field with counts", () => {
    expect(groupRows(rows, "region").map((g) => [g.key, g.count])).toEqual([["eu", 2], ["us", 1]]);
  });

  it("flattens a single-level group to DatasetQuery", () => {
    const query = compileToDatasetQuery({
      type: "group", id: "g", combinator: "OR", children: [
        { type: "condition", id: "a", field: "status", operator: "eq", value: "ok" },
      ],
    });
    expect(query).toEqual({ filters: [{ fieldId: "status", operator: "eq", value: "ok" }], filterLogic: "or", sort: undefined });
  });
});
