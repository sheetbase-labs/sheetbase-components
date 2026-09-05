import { describe, expect, it } from "vitest";
import { TableWorkbook } from "./TableWorkbook";

type State = { value: string; selection: string; scrollTop: number };

function workbook() {
  return new TableWorkbook<State>([
    { id: "experiments", label: "Experiments", kind: "dataset", state: { value: "A", selection: "C2", scrollTop: 20 } },
    { id: "notes", label: "Notes", kind: "sheet", state: { value: "B", selection: "A1", scrollTop: 0 } },
  ]);
}

describe("TableWorkbook", () => {
  it("switches sheets without losing their independent state", () => {
    const book = workbook();
    book.update("experiments", (state) => ({ ...state, value: "changed", selection: "D9" }));
    book.select("notes");
    expect(book.activeSheet.state.value).toBe("B");
    book.select("experiments");
    expect(book.activeSheet.state).toEqual({ value: "changed", selection: "D9", scrollTop: 20 });
  });

  it("adds, renames, reorders, and removes sheets deterministically", () => {
    const book = workbook();
    book.add({ id: "analysis", label: "Analysis", state: { value: "", selection: "A1", scrollTop: 0 } }, 1);
    expect(book.activeSheetId).toBe("analysis");
    book.rename("analysis", "Summary");
    book.move("analysis", 0);
    expect(book.tabs.map((tab) => tab.label)).toEqual(["Summary", "Experiments", "Notes"]);
    book.remove("analysis");
    expect(book.activeSheetId).toBe("experiments");
  });

  it("rejects duplicate ids, unknown sheets, and deletion of the final sheet", () => {
    const book = workbook();
    expect(() => book.add({ ...book.activeSheet })).toThrow("Duplicate sheet id");
    expect(() => book.select("missing")).toThrow("Unknown sheet");
    book.remove("notes");
    expect(() => book.remove("experiments")).toThrow("keep at least one sheet");
  });
});
