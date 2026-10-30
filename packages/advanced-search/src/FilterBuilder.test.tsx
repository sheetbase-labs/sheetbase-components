import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileToDatasetQuery, type ConditionNode, type GroupNode, type SheetbaseField } from "@sheetbase-labs/sheetbase-shared";
import {
  addCondition,
  addGroup,
  applyFilter,
  builderTree,
  clearFilter,
  FilterBuilder,
  matchCountLabel,
  patchCondition,
  pruneEmptyGroups,
  removeCondition,
  removeGroup,
  setCombinator,
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

describe("groups", () => {
  it("adds a group with one condition and edits inside it", () => {
    const root = addGroup(clearFilter(), STATUS);
    const group = root.children[0];
    expect(group).toMatchObject({ type: "group", combinator: "OR" });
    if (group.type !== "group") return;
    expect(group.children).toHaveLength(1);

    const more = addCondition(root, OSMOLALITY, group.id);
    expect(more.children).toHaveLength(1);
    const inner = more.children[0];
    expect(inner.type === "group" && inner.children).toHaveLength(2);

    const first = group.children[0].id;
    const patched = patchCondition(more, first, { value: "Approved" });
    const patchedGroup = patched.children[0];
    expect(patchedGroup.type === "group" && patchedGroup.children[0]).toMatchObject({ value: "Approved" });
    expect(removeCondition(patched, first).children[0]).toMatchObject({ type: "group" });
  });

  it("changes a group's combinator and never the root's", () => {
    const root = addGroup(clearFilter(), STATUS);
    const group = root.children[0];
    const none = setCombinator(root, group.id, "NOT");
    expect(none.children[0]).toMatchObject({ combinator: "NOT" });
    expect(setCombinator(root, root.id, "OR")).toBe(root);
    expect(setCombinator(root, "missing", "OR")).toBe(root);
  });

  it("removes a group as a unit and refuses the root", () => {
    const root = addGroup(addCondition(clearFilter(), STATUS), OSMOLALITY);
    const group = root.children[1];
    expect(removeGroup(root, group.id).children).toHaveLength(1);
    expect(removeGroup(root, root.id)).toBe(root);
  });

  it("keeps groups and wraps a non-AND root instead of flattening it", () => {
    const or: GroupNode = { type: "group", id: "o", combinator: "OR", children: [STATUS_CONDITION] };
    const wrapped = builderTree(or);
    expect(wrapped.combinator).toBe("AND");
    expect(wrapped.children).toEqual([or]);

    const and: GroupNode = { type: "group", id: "a", combinator: "AND", children: [STATUS_CONDITION, or] };
    expect(builderTree(and)).toBe(and);
    expect(builderTree(STATUS_CONDITION).children).toEqual([STATUS_CONDITION]);
  });

  it("prunes empty groups and keeps unchanged trees as they are", () => {
    const root = addGroup(clearFilter(), STATUS);
    const group = root.children[0];
    if (group.type !== "group") throw new Error("expected group");
    const emptied = removeCondition(root, group.children[0].id);
    expect(pruneEmptyGroups(emptied).children).toHaveLength(0);
    expect(pruneEmptyGroups(root)).toBe(root);
    expect(applyFilter(emptied)).toEqual({ filters: [], filterLogic: "and", sort: undefined });
  });

  it("applies a group as a tree query", () => {
    const root = addGroup(addCondition(clearFilter(), STATUS), OSMOLALITY, "NOT");
    const query = applyFilter(root);
    expect(query.filterTree).toBeDefined();
    expect(query.filters).toBeUndefined();
  });

  it("renders a group with its combinator picker and own add control", () => {
    const added = addGroup(clearFilter(), STATUS);
    const none = setCombinator(added, added.children[0].id, "NOT");
    const html = renderToStaticMarkup(<FilterBuilder node={none} fields={[STATUS, OSMOLALITY]} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="None of group"');
    expect(html).toContain('aria-label="Match"');
    expect(html).toContain(">All of<");
    expect(html).toContain(">Any of<");
    expect(html).toContain(">None of<");
    expect(html).toContain("Remove None of group");
    expect(html).toContain("Add group");
  });
});

describe("matchCount", () => {
  it("labels Apply with the server count", () => {
    expect(matchCountLabel(undefined)).toBe("Apply");
    expect(matchCountLabel(null)).toBe("Apply");
    expect(matchCountLabel(1)).toBe("Show 1 result");
    expect(matchCountLabel(0)).toBe("Show 0 results");
    expect(matchCountLabel(1234)).toBe("Show 1,234 results");
    const html = renderToStaticMarkup(<FilterBuilder fields={[STATUS]} matchCount={42} />);
    expect(html).toContain("Show 42 results");
    expect(html).not.toContain(">Apply<");
  });
});

describe("async options", () => {
  const PROJECT: SheetbaseField = {
    id: "project",
    label: "Project",
    dataType: "relationship",
    loadOptions: async () => [{ value: "p1", label: "AAV8 TFF" }],
  };

  it("offers equals, any of and emptiness for a remote field", () => {
    const html = renderToStaticMarkup(
      <FilterBuilder
        fields={[PROJECT]}
        node={{ type: "group", id: "g", combinator: "AND", children: [{ type: "condition", id: "c", field: "project", operator: "in", value: ["p1"] }] }}
      />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
  });
});
