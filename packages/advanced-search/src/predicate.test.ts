import { describe, expect, it } from "vitest";
import { applySearch, buildPredicate, groupRows } from "./predicate";
import type { SearchSpec } from "./types";

const rows = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
];

describe("buildPredicate", () => {
  it("ANDs conditions by default", () => {
    const fn = buildPredicate({
      type: "group", id: "g", combinator: "AND", children: [
        { type: "condition", id: "a", field: "region", operator: "eq", value: "eu" },
        { type: "condition", id: "b", field: "amount", operator: "gt", value: 1000 },
      ],
    });
    expect(rows.filter(fn)).toHaveLength(1);
  });

  it("NOT negates the conjunction of its children", () => {
    const fn = buildPredicate({
      type: "group", id: "g", combinator: "NOT", children: [
        { type: "condition", id: "a", field: "status", operator: "eq", value: "ok" },
      ],
    });
    expect(rows.filter(fn)).toHaveLength(2);
  });

  it("nests OR inside AND", () => {
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
});

describe("applySearch", () => {
  it("sorts and limits after filtering", () => {
    const spec: SearchSpec = {
      filter: { type: "group", id: "g", combinator: "AND", children: [] },
      sort: { field: "amount", direction: "desc" },
      limit: 2,
    };
    expect(applySearch(rows, spec).map((r) => r.amount)).toEqual([6000, 100]);
  });
});

describe("groupRows", () => {
  it("buckets by field with counts", () => {
    expect(groupRows(rows, "region").map((g) => [g.key, g.count])).toEqual([["eu", 2], ["us", 1]]);
  });
});
