import { describe, expect, it } from "vitest";
import { buildFilterValue, filterValueSummary } from "./query";
import { ensureOperator, normaliseOperator, operatorLabel, operatorsForField } from "./operators";

const textField = { id: "sample_id", label: "sample_id", dataType: "text" as const };
const numberField = { id: "result", label: "result", dataType: "number" as const };
const dateField = { id: "run_date", label: "run_date", dataType: "date" as const };
const booleanField = { id: "approved", label: "approved", dataType: "boolean" as const };
const optionsField = { id: "status", label: "status", dataType: "text" as const, options: ["Complete", "Review", "Flagged"] };

describe("operators", () => {
  it("aliases empty/equals names from rules and formatting", () => {
    expect(normaliseOperator("isEmpty")).toBe("isNull");
    expect(normaliseOperator("isNotEmpty")).toBe("notNull");
    expect(normaliseOperator("equals")).toBe("eq");
    expect(normaliseOperator("nope")).toBeUndefined();
  });

  it("offers operators by field data type", () => {
    expect(operatorsForField(textField)).toEqual(["eq", "neq", "contains", "startsWith", "endsWith", "in", "isNull", "notNull"]);
    expect(operatorsForField(numberField)).toContain("between");
    expect(operatorsForField(dateField)).toContain("withinLastDays");
    expect(operatorsForField(booleanField)).toEqual(["eq", "isNull", "notNull"]);
    expect(operatorsForField(optionsField)).toEqual(["eq", "neq", "in", "isNull", "notNull"]);
  });

  it("labels date comparisons with date language", () => {
    expect(operatorLabel("gt", numberField)).toBe("Greater than");
    expect(operatorLabel("gt", dateField)).toBe("After");
    expect(operatorLabel("withinLastDays", dateField)).toBe("Within the last");
  });

  it("coerces operators to the set allowed for a field", () => {
    expect(ensureOperator(dateField, "contains")).toBe("eq");
    expect(ensureOperator(numberField, "between")).toBe("between");
  });

  it("builds typed clause values", () => {
    expect(buildFilterValue(numberField, "gte", { value: "12.5" })).toEqual({ value: 12.5 });
    expect(buildFilterValue(booleanField, "eq", { value: "true" })).toEqual({ value: true });
    expect(buildFilterValue(optionsField, "in", { values: ["Review", "Flagged"] })).toEqual({ value: ["Review", "Flagged"] });
    expect(buildFilterValue(numberField, "between", { value: "1", value2: "9" })).toEqual({ value: [1, 9] });
    expect(buildFilterValue(dateField, "withinLastDays", { value: "30" })).toEqual({ value: 30 });
    expect(buildFilterValue(textField, "isNull", {})).toEqual({});
  });

  it("summarises clauses for chips", () => {
    expect(filterValueSummary({ fieldId: "result", operator: "between", value: [1, 9] })).toBe("1 – 9");
    expect(filterValueSummary({ fieldId: "status", operator: "in", value: ["Review", "Flagged"] })).toBe("Review, Flagged");
    expect(filterValueSummary({ fieldId: "run_date", operator: "withinLastDays", value: 30 })).toBe("30 days");
  });
});
