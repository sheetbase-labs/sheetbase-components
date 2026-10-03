import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROW_HEIGHT, rebaseAutoRowHeights, rowHeightFromCss } from "./row-height";

describe("rowHeightFromCss", () => {
  it("reads px and bare numbers", () => {
    expect(rowHeightFromCss("28px")).toBe(28);
    expect(rowHeightFromCss(" 31px ")).toBe(31);
    expect(rowHeightFromCss("28")).toBe(28);
    expect(rowHeightFromCss("24.5px")).toBe(24.5);
  });

  it("falls back on anything it cannot read exactly", () => {
    expect(rowHeightFromCss("")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("   ")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss(undefined)).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss(null)).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("1.5rem")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("calc(2rem)")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("0px")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("-4px")).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeightFromCss("auto")).toBe(DEFAULT_ROW_HEIGHT);
  });

  it("honours an explicit fallback", () => {
    expect(rowHeightFromCss("", 24)).toBe(24);
    expect(rowHeightFromCss("nonsense", 24)).toBe(24);
  });
});

describe("rebaseAutoRowHeights", () => {
  it("rewrites rows still holding the previous auto height", () => {
    expect(rebaseAutoRowHeights([31, 31, 31], 31, 28)).toEqual([28, 28, 28]);
  });

  it("leaves resized and hidden rows alone", () => {
    expect(rebaseAutoRowHeights([31, 60, 0, 31], 31, 28)).toEqual([28, 60, 0, 28]);
  });

  it("leaves explicitly-sized rows alone even when they match", () => {
    const explicit = (row: number) => (row === 1 ? 31 : undefined);
    expect(rebaseAutoRowHeights([31, 31, 31], 31, 28, explicit)).toEqual([28, 31, 28]);
  });

  it("returns the same array when there is nothing to change", () => {
    const heights = [28, 60, 0];
    expect(rebaseAutoRowHeights(heights, 31, 28)).toBe(heights);
    expect(rebaseAutoRowHeights(heights, 28, 28)).toBe(heights);
  });
});

describe("theme preset wiring", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("the v3 preset asks for 28px rows and the default preset keeps 31px", () => {
    expect(read("../../../shared/src/themes/v3.css")).toContain("--row-height: 28px");
    expect(read("../../../shared/src/theme.css")).toContain("--row-height: 31px");
  });

  it("DEFAULT_ROW_HEIGHT matches the default preset", () => {
    expect(DEFAULT_ROW_HEIGHT).toBe(31);
  });
});
