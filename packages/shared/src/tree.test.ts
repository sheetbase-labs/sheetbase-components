import { describe, expect, it } from "vitest";
import { queryKey } from "./query";
import { canonicalFilterTree, emptyCondition, emptyGroup, toDatasetQuery, type GroupNode } from "./tree";

const cond = (id: string, field: string, operator: "eq" | "contains" = "eq", value: unknown = "x") =>
  ({ type: "condition" as const, id, field, operator, value });
const group = (id: string, combinator: GroupNode["combinator"], children: GroupNode["children"]) =>
  ({ type: "group" as const, id, combinator, children });

describe("toDatasetQuery", () => {
  it("flattens a single-level group into filters/filterLogic", () => {
    const query = toDatasetQuery(group("g1", "OR", [cond("a", "status"), cond("b", "assay", "contains", "dna")]));
    expect(query).toEqual({
      filters: [
        { fieldId: "status", operator: "eq", value: "x" },
        { fieldId: "assay", operator: "contains", value: "dna" },
      ],
      filterLogic: "or",
      sort: undefined,
    });
    expect(query.filterTree).toBeUndefined();
  });

  it("carries a nested group as filterTree instead of returning undefined", () => {
    const tree = group("root", "AND", [cond("a", "status"), group("inner", "OR", [cond("b", "assay"), cond("c", "unit")])]);
    const query = toDatasetQuery(tree);
    expect(query.filters).toBeUndefined();
    expect(query.filterTree).toBe(tree);
  });

  it("carries a NOT group as filterTree", () => {
    const tree = group("root", "NOT", [cond("a", "status")]);
    expect(toDatasetQuery(tree).filterTree).toBe(tree);
  });

  it("keeps sort on both flat and tree queries", () => {
    const sort = [{ fieldId: "date", direction: "desc" as const }];
    expect(toDatasetQuery(group("g", "AND", [cond("a", "status")]), sort).sort).toBe(sort);
    expect(toDatasetQuery(group("g", "NOT", [cond("a", "status")]), sort).sort).toBe(sort);
  });
});

describe("canonicalFilterTree", () => {
  it("strips session-random node ids so equivalent trees canonicalise equally", () => {
    const first = canonicalFilterTree(group("grp_aaa", "AND", [cond("cnd_111", "status")]));
    const second = canonicalFilterTree(group("grp_bbb", "AND", [cond("cnd_222", "status")]));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain("grp_aaa");
  });

  it("distinguishes trees that differ structurally", () => {
    const and = canonicalFilterTree(group("g1", "AND", [cond("a", "status")]));
    const or = canonicalFilterTree(group("g2", "OR", [cond("b", "status")]));
    expect(JSON.stringify(and)).not.toBe(JSON.stringify(or));
  });
});

describe("queryKey with filterTree", () => {
  it("differs for equal-flat queries carrying different trees", () => {
    const base = { filters: [{ fieldId: "status", operator: "eq" as const, value: "x" }] };
    const withNot = { ...base, filterTree: group("g1", "NOT", [cond("a", "status")]) };
    const withOr = { ...base, filterTree: group("g2", "OR", [cond("b", "status"), cond("c", "unit")]) };
    expect(queryKey(base)).not.toBe(queryKey(withNot));
    expect(queryKey(withNot)).not.toBe(queryKey(withOr));
  });

  it("is stable for equivalent trees with different session ids", () => {
    const first = queryKey({ filterTree: group("grp_1", "NOT", [cond("cnd_1", "status")]) });
    const second = queryKey({ filterTree: group("grp_2", "NOT", [cond("cnd_9", "status")]) });
    expect(first).toBe(second);
  });

  it("is unchanged for queries without a tree", () => {
    expect(queryKey({ filters: [{ fieldId: "s", operator: "eq", value: 1 }] }))
      .toBe(queryKey({ filters: [{ fieldId: "s", operator: "eq", value: 1 }], filterTree: undefined }));
  });
});
