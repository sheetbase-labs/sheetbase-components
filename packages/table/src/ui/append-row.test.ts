import { describe, expect, it } from "vitest";
import { APPEND_ROW_LABEL, appendRowEnabled, appendRowIndex, appendRowLabel, firstWritableColumn } from "./append-row";

describe("append row", () => {
  it("is disabled unless requested", () => {
    expect(appendRowEnabled(undefined)).toBe(false);
    expect(appendRowEnabled(false)).toBe(false);
    expect(appendRowEnabled(true)).toBe(true);
    expect(appendRowEnabled({})).toBe(true);
  });

  it("uses the design copy by default and honours a custom label", () => {
    expect(appendRowLabel(undefined)).toBe(APPEND_ROW_LABEL);
    expect(appendRowLabel(true)).toBe(APPEND_ROW_LABEL);
    expect(appendRowLabel({ label: "Add a run" })).toBe("Add a run");
    expect(appendRowLabel({ label: "" })).toBe(APPEND_ROW_LABEL);
  });

  it("places the row one past the last populated row", () => {
    const data = new Map([["A1", "one"], ["C3", "three"]]);
    expect(appendRowIndex(data, true)).toBe(3);
    expect(appendRowIndex(data, undefined)).toBeUndefined();
  });

  it("starts at row 0 on an empty sheet", () => {
    expect(appendRowIndex(new Map(), true)).toBe(0);
  });

  it("picks the first writable column for a draft", () => {
    expect(firstWritableColumn([{ column: 0, writable: false }, { column: 2 }, { column: 1 }])).toBe(1);
    expect(firstWritableColumn([{ column: 0, writable: false }])).toBe(0);
    expect(firstWritableColumn([])).toBe(0);
  });
});
