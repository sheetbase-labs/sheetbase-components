import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileToDatasetQuery, type ConditionNode, type GroupNode, type SheetbaseField } from "@sheetbase-labs/sheetbase-shared";
import {
  addCondition,
  addGroup,
  applyFilter,
  builderTree,
  clearFilter,
  connectorLabel,
  FilterBuilder,
  groupSummary,
  matchCountLabel,
  moveNode,
  patchCondition,
  pruneEmptyGroups,
  removeCondition,
  removeGroup,
  ruleOperatorLabel,
  setCombinator,
  toggleCombinator,
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
    expect(html).toContain('class="sb-fb-row"');
    expect(html).toContain('aria-label="Move condition"');
    expect(html).toContain(">is<");
    expect(html).toContain("Equal to");
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain('aria-label="Operator"');
    expect(html).toContain('aria-label="Value"');
    expect(html).toContain('aria-label="Remove condition"');
    expect(html).toContain("In progress");
    expect(html).toContain("Add rule");
    expect(html).toContain("Add group");
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

  it("renders a group card with its count, none-of switch and own add control", () => {
    const added = addGroup(addCondition(clearFilter(), STATUS), STATUS);
    const group = added.children[1] as GroupNode;
    const more = addCondition(added, OSMOLALITY, group.id);
    const html = renderToStaticMarkup(<FilterBuilder node={more} fields={[STATUS, OSMOLALITY]} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Group"');
    expect(html).toContain("<strong>Group</strong> · 2 conditions");
    expect(html).toContain(">None of these<");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Remove group");
    expect(html).toContain("Add condition");

    const none = setCombinator(more, group.id, "NOT");
    const noneHtml = renderToStaticMarkup(<FilterBuilder node={none} fields={[STATUS, OSMOLALITY]} />);
    expect(noneHtml).toContain("<strong>None of these</strong> · 2 conditions");
    expect(noneHtml).toContain('aria-pressed="true"');
    expect(noneHtml).toContain('aria-label="None of these group"');
  });

  it("counts conditions in nested groups and says 1 condition", () => {
    const root = addGroup(clearFilter(), STATUS);
    const group = root.children[0] as GroupNode;
    expect(groupSummary(group)).toEqual({ title: "Group", count: "1 condition" });
    const nested = addGroup(addCondition(root, OSMOLALITY, group.id), STATUS);
    expect(groupSummary(nested.children[0] as GroupNode).count).toBe("2 conditions");
  });
});

describe("rail pill", () => {
  it("shows a static And pill on the root and a button pill on groups of two or more", () => {
    const root = addGroup(addCondition(clearFilter(), STATUS), STATUS);
    const group = root.children[1] as GroupNode;
    const two = addCondition(root, OSMOLALITY, group.id);
    const html = renderToStaticMarkup(<FilterBuilder node={two} fields={[STATUS, OSMOLALITY]} />);
    expect(html).toContain('<span class="sb-fb-pill" data-static="true" title="Every rule must match">And</span>');
    expect(html).toMatch(/<button[^>]*class="sb-fb-pill"[^>]*>Or<\/button>/);
    // One row has no rail and so no pill.
    expect(renderToStaticMarkup(<FilterBuilder node={addCondition(clearFilter(), STATUS)} fields={[STATUS]} />)).not.toContain("sb-fb-pill");
  });

  it("toggles a group between And and Or, and leaves the root and None of alone", () => {
    const root = addGroup(clearFilter(), STATUS);
    const group = root.children[0];
    const and = toggleCombinator(root, group.id);
    expect(and.children[0]).toMatchObject({ combinator: "AND" });
    expect(toggleCombinator(and, group.id).children[0]).toMatchObject({ combinator: "OR" });
    expect(toggleCombinator(root, root.id)).toBe(root);
    expect(toggleCombinator(root, "missing")).toBe(root);
    const none = setCombinator(root, group.id, "NOT");
    expect(toggleCombinator(none, group.id)).toBe(none);
  });

  it("reads a None of group as Or on the rail", () => {
    expect(connectorLabel("AND")).toBe("And");
    expect(connectorLabel("OR")).toBe("Or");
    expect(connectorLabel("NOT")).toBe("Or");
  });
});

describe("operator words", () => {
  it("reads operators as words, dates as After / Before", () => {
    expect(ruleOperatorLabel("eq")).toBe("Equal to");
    expect(ruleOperatorLabel("in")).toBe("Any of");
    expect(ruleOperatorLabel("contains")).toBe("Contains");
    expect(ruleOperatorLabel("gt")).toBe("Greater than");
    expect(ruleOperatorLabel("gt", { dataType: "date" })).toBe("After");
  });
});

describe("variant", () => {
  it("defaults to the popover card and offers an inline layout", () => {
    expect(renderToStaticMarkup(<FilterBuilder fields={[STATUS]} />)).toContain('data-variant="popover"');
    expect(renderToStaticMarkup(<FilterBuilder fields={[STATUS]} variant="inline" />)).toContain('data-variant="inline"');
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

describe("moveNode", () => {
  const tree = (): GroupNode => {
    const a = addCondition(addCondition(addCondition(clearFilter(), STATUS), OSMOLALITY), STATUS);
    return addCondition(addGroup(a, STATUS), OSMOLALITY, undefined);
  };
  const ids = (group: GroupNode) => group.children.map((child) => child.id);

  it("reorders inside one list, counting the index after removal", () => {
    const root = tree();
    const [a, b, c] = ids(root);
    expect(ids(moveNode(root, a, root.id, 2)).slice(0, 3)).toEqual([b, c, a]);
    expect(ids(moveNode(root, c, root.id, 0)).slice(0, 3)).toEqual([c, a, b]);
    expect(moveNode(root, a, root.id, 99).children.at(-1)?.id).toBe(a);
    expect(ids(moveNode(root, a, root.id, -5))[0]).toBe(a);
  });

  it("moves a row into a group and back out", () => {
    const root = tree();
    const group = root.children.find((child) => child.type === "group");
    if (!group) throw new Error("expected group");
    const [a] = ids(root);
    const into = moveNode(root, a, group.id, 0);
    const inner = into.children.find((child) => child.id === group.id);
    expect(inner?.type === "group" && inner.children[0].id).toBe(a);
    expect(into.children.some((child) => child.id === a)).toBe(false);
    const out = moveNode(into, a, root.id, 0);
    expect(out.children[0].id).toBe(a);
  });

  it("refuses to move a group into itself, move the root or use unknown ids", () => {
    const root = tree();
    const group = root.children.find((child) => child.type === "group");
    if (group?.type !== "group") throw new Error("expected group");
    expect(moveNode(root, group.id, group.id, 0)).toBe(root);
    const nested = addGroup(root, STATUS);
    const inner = nested.children.at(-1) as GroupNode;
    const into = moveNode(nested, inner.id, group.id, 0);
    expect(moveNode(into, group.id, inner.id, 0)).toBe(into);
    expect(moveNode(root, root.id, group.id, 0)).toBe(root);
    expect(moveNode(root, "missing", root.id, 0)).toBe(root);
    expect(moveNode(root, ids(root)[0], "missing", 0)).toBe(root);
    expect(moveNode(root, ids(root)[0], ids(root)[1], 0)).toBe(root);
  });
});
