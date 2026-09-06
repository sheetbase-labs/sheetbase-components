import { describe, expect, it } from "vitest";
import { conditionalFormatMatches, resolveConditionalFormat, type ConditionalFormatRule } from "./conditional-formatting";

describe("conditional formatting", () => {
  it("supports text, numeric, blank and interval conditions", () => {
    expect(conditionalFormatMatches({ operator: "contains", value: "view", format: {} }, "Review")).toBe(true);
    expect(conditionalFormatMatches({ operator: "greaterThan", value: 10, format: {} }, "10.1")).toBe(true);
    expect(conditionalFormatMatches({ operator: "between", value: 10, value2: 20, format: {} }, "15")).toBe(true);
    expect(conditionalFormatMatches({ operator: "isBlank", format: {} }, "  ")).toBe(true);
  });

  it("targets fields and ranges and merges rules in order", () => {
    const rules: ConditionalFormatRule[] = [
      { fieldId: "status", operator: "equals", value: "Review", format: { foreground: "amber", fontWeight: 500 } },
      { range: { start: { row: 2, column: 6 }, end: { row: 4, column: 6 } }, operator: "isNotBlank", format: { background: "cream" } },
    ];
    expect(resolveConditionalFormat({ row: 3, column: 6 }, "Review", "status", rules)).toEqual({ foreground: "amber", fontWeight: 500, background: "cream" });
    expect(resolveConditionalFormat({ row: 8, column: 6 }, "Review", "assay", rules)).toBeUndefined();
  });

  it("interpolates numeric colour scales across both halves", () => {
    const rules: ConditionalFormatRule[] = [{
      fieldId: "result",
      operator: "isNotBlank",
      format: { foreground: "#222222" },
      colorScale: {
        min: 0, midpoint: 50, max: 100,
        minColor: "#000000", midpointColor: "#808080", maxColor: "#ffffff",
      },
    }];
    expect(resolveConditionalFormat({ row: 0, column: 3 }, "0", "result", rules)?.background).toBe("#000000");
    expect(resolveConditionalFormat({ row: 0, column: 3 }, "25", "result", rules)?.background).toBe("#404040");
    expect(resolveConditionalFormat({ row: 0, column: 3 }, "75", "result", rules)?.background).toBe("#c0c0c0");
    expect(resolveConditionalFormat({ row: 0, column: 3 }, "not numeric", "result", rules)).toBeUndefined();
  });

  it("formats an entire row from another semantic field", () => {
    const rules: ConditionalFormatRule[] = [{
      fieldId: "status",
      applyTo: "row",
      operator: "equals",
      value: "Flagged",
      format: { background: "#fff1f1" },
    }];
    const rowValues = new Map([["status", "Flagged"], ["result", "12.4"]]);
    expect(resolveConditionalFormat({ row: 4, column: 3 }, "12.4", "result", rules, (field) => rowValues.get(field) ?? "")).toEqual({ background: "#fff1f1" });
    rowValues.set("status", "Complete");
    expect(resolveConditionalFormat({ row: 4, column: 3 }, "12.4", "result", rules, (field) => rowValues.get(field) ?? "")).toBeUndefined();
  });

  it("limits selection-targeted rules to their stored range", () => {
    const rules: ConditionalFormatRule[] = [{
      fieldId: "status",
      applyTo: "range",
      range: { start: { row: 1, column: 1 }, end: { row: 3, column: 4 } },
      operator: "equals",
      value: "Flagged",
      format: { fontWeight: 600 },
    }];
    const status = () => "Flagged";
    expect(resolveConditionalFormat({ row: 2, column: 2 }, "value", "assay", rules, status)).toEqual({ fontWeight: 600 });
    expect(resolveConditionalFormat({ row: 8, column: 2 }, "value", "assay", rules, status)).toBeUndefined();
  });

  it("can test one field and format another column on matching rows", () => {
    const rules: ConditionalFormatRule[] = [{
      fieldId: "status",
      applyTo: "column",
      targetFieldId: "result",
      operator: "equals",
      value: "Flagged",
      format: { foreground: "#a23131" },
    }];
    const status = () => "Flagged";
    expect(resolveConditionalFormat({ row: 1, column: 3 }, "12", "result", rules, status)).toEqual({ foreground: "#a23131" });
    expect(resolveConditionalFormat({ row: 1, column: 2 }, "p24", "assay", rules, status)).toBeUndefined();
  });
});
