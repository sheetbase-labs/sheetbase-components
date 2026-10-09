import { describe, expect, it } from "vitest";
import { clampGridPoint, selectionForPoint } from "./grid-focus";

describe("clampGridPoint", () => {
  it("keeps an in-range point", () => {
    expect(clampGridPoint({ row: 3, column: 2 }, 10, 5)).toEqual({ row: 3, column: 2 });
  });

  it("clamps negative and out-of-range coordinates to the last addressable cell", () => {
    expect(clampGridPoint({ row: -4, column: 99 }, 10, 5)).toEqual({ row: 0, column: 4 });
  });

  it("treats an empty grid as a single cell", () => {
    expect(clampGridPoint({ row: 7, column: 7 }, 0, 0)).toEqual({ row: 0, column: 0 });
  });
});

describe("selectionForPoint", () => {
  const current = { anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } };

  it("collapses the selection to the point", () => {
    expect(selectionForPoint(current, { row: 5, column: 4 })).toEqual({
      anchor: { row: 5, column: 4 },
      focus: { row: 5, column: 4 },
    });
  });

  it("extends from the existing anchor", () => {
    expect(selectionForPoint(current, { row: 5, column: 4 }, true)).toEqual({
      anchor: { row: 1, column: 1 },
      focus: { row: 5, column: 4 },
    });
  });
});
