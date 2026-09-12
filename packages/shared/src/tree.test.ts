import { describe, expect, it } from "vitest";
import { queryKey } from "./query";
import { andCondition, canonicalFilterTree, toDatasetQuery, withoutCondition, type GroupNode } from "./tree";

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

describe("andCondition", () => {
  it("appends to an AND root without mutating it", () => {
    const root = group("g1", "AND", [cond("a", "status")]);
    const next = andCondition(root, cond("b", "assay", "contains", "dna"));
    expect(next.children).toHaveLength(2);
    expect(next.children[0]).toBe(root.children[0]);
    expect(next.id).toBe("g1");
    expect(root.children).toHaveLength(1);
  });

  it("wraps a non-AND root so the existing tree stays intact under one AND", () => {
    const or = group("g1", "OR", [cond("a", "status"), cond("b", "unit")]);
    const next = andCondition(or, cond("c", "assay"));
    expect(next.combinator).toBe("AND");
    expect(next.children[0]).toBe(or);
    expect(next.children[1]).toMatchObject({ field: "assay" });
  });
});

describe("withoutCondition", () => {
  it("removes only the matching root-level condition", () => {
    const root = group("g1", "AND", [
      cond("a", "status", "eq", "Flagged"),
      cond("b", "assay", "eq", "BCA"),
      cond("c", "status", "contains", "Flagged"),
    ]);
    const next = withoutCondition(root, { field: "status", operator: "eq", value: "Flagged" });
    expect(next.children.map((child) => child.id)).toEqual(["b", "c"]);
    expect(root.children).toHaveLength(3);
  });

  it("matches on serialised value, not reference", () => {
    const root = group("g1", "AND", [cond("a", "meta", "eq", { tag: "x" })]);
    const next = withoutCondition(root, { field: "meta", operator: "eq", value: { tag: "x" } });
    expect(next.children).toHaveLength(0);
  });

  it("returns the same reference when nothing matches (containment check)", () => {
    const root = group("g1", "AND", [cond("a", "status", "eq", "Flagged")]);
    expect(withoutCondition(root, { field: "status", operator: "eq", value: "Review" })).toBe(root);
    expect(withoutCondition(root, { field: "status", operator: "neq", value: "Flagged" })).toBe(root);
  });

  it("leaves nested conditions alone", () => {
    const inner = group("inner", "OR", [cond("a", "status", "eq", "Flagged")]);
    const root = group("g1", "AND", [inner]);
    expect(withoutCondition(root, { field: "status", operator: "eq", value: "Flagged" })).toBe(root);
  });

  it("round-trips: andCondition then withoutCondition restores the root", () => {
    const root = group("g1", "AND", [cond("a", "status", "eq", "Review")]);
    const added = andCondition(root, cond("b", "status", "eq", "Flagged"));
    const stripped = withoutCondition(added, { field: "status", operator: "eq", value: "Flagged" });
    expect(stripped.children).toEqual(root.children);
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
