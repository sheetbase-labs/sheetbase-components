import { describe, expect, it } from "vitest";
import { RangeStore } from "./range-store";

describe("RangeStore", () => {
  it("uses last write wins while preserving uncovered rectangles", () => {
    const store = new RangeStore<string>();
    store.write({ start: { row: 0, column: 0 }, end: { row: 9, column: 9 } }, "white");
    store.write({ start: { row: 2, column: 2 }, end: { row: 4, column: 4 } }, "purple");
    expect(store.get({ row: 3, column: 3 })).toBe("purple");
    expect(store.get({ row: 8, column: 8 })).toBe("white");
  });

  it("greedily merges rectangles sharing a complete edge", () => {
    const store = new RangeStore<string>();
    store.write({ start: { row: 0, column: 0 }, end: { row: 0, column: 4 } }, "bold");
    store.write({ start: { row: 1, column: 0 }, end: { row: 1, column: 4 } }, "bold");
    expect(store.size).toBe(1);
  });

  it("clones without sharing future mutations", () => {
    const store = new RangeStore<string>();
    store.write({ start: { row: 0, column: 0 }, end: { row: 1, column: 1 } }, "bold");
    const copy = store.clone();
    copy.write({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }, "plain");
    expect(store.get({ row: 0, column: 0 })).toBe("bold");
    expect(copy.get({ row: 0, column: 0 })).toBe("plain");
  });

  it("locally consolidates long adjacent runs", () => {
    const store = new RangeStore<string>();
    for (let row = 0; row < 1_000; row++) {
      store.write({ start: { row, column: 0 }, end: { row, column: 0 } }, "same");
    }
    expect(store.size).toBe(1);
    expect(store.get({ row: 999, column: 0 })).toBe("same");
  });
});
