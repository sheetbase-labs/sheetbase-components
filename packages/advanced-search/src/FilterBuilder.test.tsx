import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileToDatasetQuery, type ConditionNode, type GroupNode, type SheetbaseField } from "@sheetbase-labs/sheetbase-shared";
import {
  addCondition,
  applyFilter,
  builderTree,
  clearFilter,
  FilterBuilder,
  patchCondition,
  removeCondition,
} from "./FilterBuilder";

const STATUS: SheetbaseField = {
  id: "status",
  label: "Status",
  dataType: "text",
  options: ["In progress", "Approved"],
};
const OSMOLALITY: SheetbaseField = { id: "osmolality", label: "Osmolality", dataType: "number" };

const STATUS_CONDITION: ConditionNode = {
  type: "condition",
  id: "c1",
  field: "status",
  operator: "eq",
  value: "In progress",
};

describe("addCondition", () => {
  it("appends an empty condition for the field and keeps the AND root", () => {
    const root = clearFilter();
    const next = addCondition(root, STATUS);
    expect(next.combinator).toBe("AND");
    expect(next.children).toHaveLength(1);
    const [condition] = next.children;
    expect(condition.type).toBe("condition");
    if (condition.type !== "condition") return;
    expect(condition.field).toBe("status");
    expect(condition.operator).toBe("eq");
    expect(condition.value).toBe("");
  });

  it("defaults the operator for the field's type", () => {
    const next = addCondition(clearFilter(), OSMOLALITY);
    const [condition] = next.children;
    expect(condition.type === "condition" && condition.operator).toBe("eq");
  });
});

describe("clearFilter", () => {
  it("returns an empty AND root", () => {
    const root = builderTree({ type: "group", id: "g", combinator: "AND", children: [STATUS_CONDITION] });
    expect(root.children).toHaveLength(1);
    expect(clearFilter()).toMatchObject({ type: "group", combinator: "AND", children: [] });
  });
});

describe("patchCondition / removeCondition", () => {
  it("patches the matching condition and leaves others untouched", () => {
    const root = addCondition(clearFilter(), STATUS);
    const id = root.children[0].id;
    const patched = patchCondition(root, id, { value: "Approved" });
    expect(patched.children[0]).toMatchObject({ value: "Approved" });
    expect(patchCondition(root, "missing", { value: "x" })).toBe(root);
  });

  it("removes the matching condition", () => {
    const one = addCondition(clearFilter(), STATUS);
    const two = addCondition(one, OSMOLALITY);
    const removed = removeCondition(two, one.children[0].id);
    expect(removed.children).toHaveLength(1);
    expect(removed.children[0]).toMatchObject({ field: "osmolality" });
    expect(removeCondition(two, "missing")).toBe(two);
  });
});

describe("applyFilter", () => {
  it("compiles an AND root to flat filters", () => {
    const root = addCondition(addCondition(clearFilter(), STATUS), OSMOLALITY);
    const query = applyFilter(root);
    expect(query.filterLogic).toBe("and");
    expect(query.filters).toHaveLength(2);
    expect(query.filters?.[0]).toMatchObject({ fieldId: "status", operator: "eq" });
    expect(query.filterTree).toBeUndefined();
    expect(compileToDatasetQuery(root)).toEqual(query);
  });

  it("keeps a tree query when the draft cannot flatten", () => {
    const notRoot: GroupNode = {
      type: "group",
      id: "g",
      combinator: "NOT",
      children: [STATUS_CONDITION],
    };
    const query = applyFilter(notRoot);
    expect(query.filters).toBeUndefined();
    expect(query.filterTree).toBe(notRoot);
  });

  it("emits an empty flat query for a cleared builder", () => {
    expect(applyFilter(clearFilter())).toEqual({ filters: [], filterLogic: "and", sort: undefined });
  });
});

describe("FilterBuilder", () => {
  it("renders a row per condition and the add / clear / apply controls", () => {
    const node: GroupNode = {
      type: "group",
      id: "g",
      combinator: "AND",
      children: [STATUS_CONDITION],
    };
    const html = renderToStaticMarkup(<FilterBuilder node={node} fields={[STATUS, OSMOLALITY]} />);
    expect(html).toContain('class="sb-filter-builder-row"');
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain('aria-label="Operator"');
    expect(html).toContain('aria-label="Value"');
    expect(html).toContain('aria-label="Remove condition"');
    expect(html).toContain("In progress");
    expect(html).toContain("Add condition");
    expect(html).toContain(">Clear<");
    expect(html).toContain(">Apply<");
  });

  it("renders an empty-state hint with no conditions", () => {
    const html = renderToStaticMarkup(<FilterBuilder fields={[STATUS]} />);
    expect(html).toContain("No conditions");
  });
});
