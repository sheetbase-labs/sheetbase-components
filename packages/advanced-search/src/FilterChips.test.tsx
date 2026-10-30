import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConditionNode, FilterNode, SheetbaseField } from "@sheetbase-labs/sheetbase-shared";
import { describeCondition, describeNode, FilterChips } from "./FilterChips";
import { rememberOptions } from "./option-labels";

const STATUS: SheetbaseField = { id: "status", label: "Status", dataType: "text" };
const OSMOLALITY: SheetbaseField = { id: "osmolality", label: "Osmolality", dataType: "number" };

const STATUS_CONDITION: ConditionNode = {
  type: "condition",
  id: "c1",
  field: "status",
  operator: "eq",
  value: "In progress",
};
const EMPTY_CONDITION: ConditionNode = {
  type: "condition",
  id: "c2",
  field: "osmolality",
  operator: "isNull",
};
const NODE: FilterNode = {
  type: "group",
  id: "g",
  combinator: "AND",
  children: [STATUS_CONDITION, EMPTY_CONDITION],
};

describe("describeCondition", () => {
  it("uses the field label and the short operator with its value", () => {
    expect(describeCondition(STATUS_CONDITION, [STATUS])).toBe("Status is In progress");
  });

  it("has no value for an emptiness operator", () => {
    expect(describeCondition(EMPTY_CONDITION, [OSMOLALITY])).toBe("Osmolality is empty");
  });

  it("falls back to the field id when no metadata is given", () => {
    expect(describeCondition(STATUS_CONDITION)).toBe("status is In progress");
  });
});

describe("FilterChips", () => {
  it("renders one named chip per condition and the add button", () => {
    const html = renderToStaticMarkup(
      <FilterChips node={NODE} fields={[STATUS, OSMOLALITY]} onRemove={() => {}} onAdd={() => {}} />,
    );
    expect(html).toContain('class="chip"');
    expect(html).toContain("Status is In progress");
    expect(html).toContain('aria-label="Remove filter: Status is In progress"');
    expect(html).toContain("Osmolality is empty");
    expect(html).toContain("+ Add filter");
  });

  it("renders nothing when there is nothing to show", () => {
    expect(renderToStaticMarkup(<FilterChips node={null} />)).toBe("");
  });
});

const PROJECT_CONDITION: ConditionNode = { type: "condition", id: "c3", field: "project", operator: "eq", value: "p-1" };
const PROJECT: SheetbaseField = {
  id: "project",
  label: "Project",
  dataType: "relationship",
  loadOptions: async () => [],
};

describe("groups", () => {
  const none: FilterNode = { type: "group", id: "n", combinator: "NOT", children: [PROJECT_CONDITION] };
  const any: FilterNode = {
    type: "group",
    id: "o",
    combinator: "OR",
    children: [STATUS_CONDITION, { ...STATUS_CONDITION, id: "c4", value: "Approved" }],
  };

  it("describes a group with its lead", () => {
    expect(describeNode(none, [PROJECT])).toBe("None of: Project is p-1");
    expect(describeNode(any, [STATUS])).toBe("Any of: Status is In progress · Status is Approved");
    expect(describeNode({ type: "group", id: "e", combinator: "OR", children: [] })).toBe("");
  });

  it("renders a group as one removable, editable chip", () => {
    const root: FilterNode = { type: "group", id: "g", combinator: "AND", children: [STATUS_CONDITION, none] };
    const html = renderToStaticMarkup(
      <FilterChips node={root} fields={[STATUS, PROJECT]} onRemove={() => {}} onEdit={() => {}} />,
    );
    expect(html.match(/class="chip/g)).toHaveLength(2);
    expect(html).toContain("None of: Project is p-1");
    expect(html).toContain('aria-label="Remove filter: None of: Project is p-1"');
    expect(html).toContain('aria-label="Edit filter: None of: Project is p-1"');
  });

  it("shows a non-AND root as a single chip", () => {
    const html = renderToStaticMarkup(<FilterChips node={any} fields={[STATUS]} />);
    expect(html.match(/class="chip/g)).toHaveLength(1);
    expect(html).toContain("Any of:");
  });

  it("shows an any-of condition as a list", () => {
    const cond: ConditionNode = { type: "condition", id: "i", field: "status", operator: "in", value: ["Approved", "In review"] };
    expect(describeCondition(cond, [STATUS])).toBe("Status is any of Approved, In review");
  });
});

describe("option labels", () => {
  it("shows a remembered label in place of the stored value", () => {
    rememberOptions(PROJECT, [{ value: "p-1", label: "AAV8 TFF" }]);
    const root: FilterNode = { type: "group", id: "g", combinator: "AND", children: [PROJECT_CONDITION] };
    const html = renderToStaticMarkup(<FilterChips node={root} fields={[PROJECT]} />);
    expect(html).toContain("Project is AAV8 TFF");
    expect(html).not.toContain("p-1");
  });
});
