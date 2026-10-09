import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConditionNode, FilterNode, SheetbaseField } from "@sheetbase-labs/sheetbase-shared";
import { describeCondition, FilterChips } from "./FilterChips";

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
