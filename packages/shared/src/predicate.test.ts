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
