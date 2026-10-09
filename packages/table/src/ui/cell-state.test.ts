import { describe, expect, it } from "vitest";
import {
  cellStateClassName,
  cellStateLabel,
  conflictValueLabel,
  diffText,
  resolveCellState,
  sameCellState,
  type CellStateName,
} from "./cell-state";

const simpleStates = ["invalid", "flagged", "pending", "derived", "readonly", "unsynced"] as const;

describe("resolveCellState", () => {
  it("returns undefined for no state", () => {
    expect(resolveCellState(undefined)).toBeUndefined();
    expect(resolveCellState(null)).toBeUndefined();
  });

  it.each(simpleStates)("passes through the %s state", (state) => {
    expect(resolveCellState(state)).toEqual({ state });
  });

  it("carries the conflict count", () => {
    expect(resolveCellState({ state: "conflict", count: 2 })).toEqual({ state: "conflict", count: 2 });
  });

  it("carries the diff before/after", () => {
    expect(resolveCellState({ state: "diff", before: "61.5", after: "62.0" })).toEqual({ state: "diff", before: "61.5", after: "62.0" });
    expect(resolveCellState({ state: "diff", after: "new" })).toEqual({ state: "diff", before: undefined, after: "new" });
  });
});

describe("cellStateClassName", () => {
  it("is empty without a state", () => {
    expect(cellStateClassName(undefined)).toBe("");
  });

  it.each([...simpleStates, "conflict", "diff"] as CellStateName[])("paints cell-%s", (state) => {
    expect(cellStateClassName({ state })).toBe(` cell-${state}`);
  });
});

describe("cellStateLabel", () => {
  it("names every state", () => {
    expect(cellStateLabel({ state: "invalid" })).toBe("Invalid value");
    expect(cellStateLabel({ state: "flagged" })).toBe("Flagged value");
    expect(cellStateLabel({ state: "pending" })).toBe("Pending value");
    expect(cellStateLabel({ state: "derived" })).toBe("Derived value");
    expect(cellStateLabel({ state: "readonly" })).toBe("Read-only value");
    expect(cellStateLabel({ state: "unsynced" })).toBe("Unsynced local edit");
    expect(cellStateLabel({ state: "conflict", count: 2 })).toBe("2 values in conflict");
    expect(cellStateLabel({ state: "diff", after: "x" })).toBe("Changed value");
    expect(cellStateLabel(undefined)).toBeUndefined();
  });
});

describe("conflictValueLabel", () => {
  it("uses the design's plural wording", () => {
    expect(conflictValueLabel(2)).toBe("2 values");
    expect(conflictValueLabel(1)).toBe("1 value");
  });
});

describe("diffText", () => {
  it("renders before → after, or just after for an addition", () => {
    expect(diffText({ state: "diff", before: "61.5", after: "62.0" })).toBe("61.5 → 62.0");
    expect(diffText({ state: "diff", after: "62.0" })).toBe("62.0");
    expect(diffText(undefined)).toBeUndefined();
    expect(diffText({ state: "invalid" })).toBeUndefined();
  });
});

describe("sameCellState", () => {
  it("compares by value, not identity", () => {
    expect(sameCellState(undefined, undefined)).toBe(true);
    expect(sameCellState(undefined, { state: "invalid" })).toBe(false);
    expect(sameCellState({ state: "conflict", count: 2 }, { state: "conflict", count: 2 })).toBe(true);
    expect(sameCellState({ state: "conflict", count: 2 }, { state: "conflict", count: 3 })).toBe(false);
    expect(sameCellState({ state: "diff", before: "a", after: "b" }, { state: "diff", before: "a", after: "b" })).toBe(true);
    expect(sameCellState({ state: "diff", before: "a", after: "b" }, { state: "diff", before: "a", after: "c" })).toBe(false);
  });
});
