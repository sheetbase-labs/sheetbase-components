import { describe, expect, it } from "vitest";
import { enterIntent, tabIntent } from "./keyboard";

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

describe("enterIntent", () => {
  it("edits the focused cell on Enter (design: Enter edits and saves a row)", () => {
    expect(enterIntent({ shiftKey: false, hasCopyMarquee: false, canEdit: true })).toBe("edit");
  });

  it("keeps vertical movement for cells that cannot be edited", () => {
    // Read-only grid, read-only row, or a non-writable field column.
    expect(enterIntent({ shiftKey: false, hasCopyMarquee: false, canEdit: false })).toBe("move");
  });

  it("reverses vertical movement on Shift+Enter", () => {
    expect(enterIntent({ shiftKey: true, hasCopyMarquee: false, canEdit: true })).toBe("move");
  });

  it("pastes once while a copy marquee is live", () => {
    expect(enterIntent({ shiftKey: false, hasCopyMarquee: true, canEdit: true })).toBe("paste");
    expect(enterIntent({ shiftKey: true, hasCopyMarquee: true, canEdit: false })).toBe("paste");
  });
});
