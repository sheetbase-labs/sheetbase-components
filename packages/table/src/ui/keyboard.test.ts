import { describe, expect, it } from "vitest";
import { tabIntent } from "./keyboard";

describe("tabIntent", () => {
  it("moves right inside the row", () => {
    expect(tabIntent({ shiftKey: false, column: 0, columnCount: 5 })).toBe("move");
    expect(tabIntent({ shiftKey: false, column: 3, columnCount: 5 })).toBe("move");
  });

  it("leaves the grid at the last column", () => {
    expect(tabIntent({ shiftKey: false, column: 4, columnCount: 5 })).toBe("leave");
  });

  it("mirrors on Shift+Tab", () => {
    expect(tabIntent({ shiftKey: true, column: 3, columnCount: 5 })).toBe("move");
    expect(tabIntent({ shiftKey: true, column: 0, columnCount: 5 })).toBe("leave");
  });
});
