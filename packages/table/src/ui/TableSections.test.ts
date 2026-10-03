import { describe, expect, it } from "vitest";
import { minimalTableSections, notebookTableSections } from "./TableSections";

describe("table section presets", () => {
  it("notebook blocks carry only the grid", () => {
    expect(notebookTableSections.menuBar).toBe(false);
    expect(notebookTableSections.toolbar).toBe(false);
    expect(notebookTableSections.formulaBar).toBe(false);
    expect(notebookTableSections.sidebar).toBe(false);
    expect(notebookTableSections.statusBar).toBe(false);
    expect(notebookTableSections.sheetBar).toBe(false);
  });

  it("leaves the existing minimal preset unchanged", () => {
    expect(minimalTableSections).toEqual({ menuBar: false, toolbar: false, formulaBar: true, sidebar: false, statusBar: false, sheetBar: true });
  });
});
