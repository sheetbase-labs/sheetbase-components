import { describe, expect, it } from "vitest";
import { orderColumnsById, stretchColumnWidths } from "./column-layout";

describe("orderColumnsById", () => {
  const columns = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];

  it("returns the input order when no order is given", () => {
    expect(orderColumnsById(columns, undefined).map((column) => column.id)).toEqual(["a", "b", "c"]);
    expect(orderColumnsById(columns, []).map((column) => column.id)).toEqual(["a", "b", "c"]);
  });

  it("applies a saved initial order and appends columns it does not name", () => {
    expect(orderColumnsById(columns, ["c", "a"]).map((column) => column.id)).toEqual(["c", "a", "b"]);
  });

  it("drops unknown ids and duplicate ids, without reordering the remainder", () => {
    expect(orderColumnsById(columns, ["b", "b", "missing"]).map((column) => column.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps the original objects", () => {
    const [first] = orderColumnsById(columns, ["c"]);
    expect(first).toBe(columns[2]);
  });
});

describe("stretchColumnWidths", () => {
  it("leaves widths untouched for mode none, overflow, or no space", () => {
    const widths = [100, 100];
    expect(stretchColumnWidths(widths, 400, "none")).toEqual([100, 100]);
    expect(stretchColumnWidths(widths, 200, "all")).toEqual([100, 100]);
    expect(stretchColumnWidths(widths, 0, "all")).toEqual([100, 100]);
    expect(stretchColumnWidths(widths, -10, "last")).toEqual([100, 100]);
  });

  it("gives the whole slack to the last visible column in mode last", () => {
    expect(stretchColumnWidths([100, 100, 0], 260, "last")).toEqual([100, 160, 0]);
  });

  it("shares the slack across visible columns in mode all", () => {
    expect(stretchColumnWidths([100, 100], 260, "all")).toEqual([130, 130]);
    expect(stretchColumnWidths([100, 100, 0], 260, "all")).toEqual([130, 130, 0]);
  });

  it("returns a copy so callers never mutate the base array", () => {
    const widths = [100, 100];
    const stretched = stretchColumnWidths(widths, 300, "all");
    expect(stretched).not.toBe(widths);
    expect(widths).toEqual([100, 100]);
  });

  it("returns the input when every column is hidden", () => {
    expect(stretchColumnWidths([0, 0], 200, "all")).toEqual([0, 0]);
    expect(stretchColumnWidths([0, 0], 200, "last")).toEqual([0, 0]);
  });
});
