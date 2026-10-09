import { describe, expect, it } from "vitest";
import { applyFormulaReference, applyFormulaSuggestion, applyTsvRows, buildWorksheet, changeGridStructure, clearRangeTargets, clearSelection, completeFormula, cycleAbsoluteReference, displayValue, edgeOfData, fillSelection, formulaErrorMessage, formulaReferenceRanges, formulaSuggestions, moveFormulaReference, moveRange, moveSelection, normaliseSelection, parseTsv, pasteTargetChanges, pasteTsv, populatedColumnSelection, renameSheetReferences, replaceAllText, selectionAddresses, selectionAggregates, selectionToTsv, shiftFormulaReferences, sortGridRows, usedRangeBounds, validateTypedCell } from "./model";

describe("grid model", () => {
  it("moves and extends a selection within bounds", () => {
    const initial = { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } };
    expect(moveSelection(initial, { row: -5, column: 2 }, 10, 4, true)).toEqual({
      anchor: { row: 1, column: 1 }, focus: { row: 0, column: 3 },
    });
  });

  it("round-trips rectangular TSV data", () => {
    const pasted = pasteTsv(new Map(), { row: 1, column: 1 }, "a\tb\nc\td", 10, 10);
    expect(selectionToTsv(pasted.data, pasted.selection)).toBe("a\tb\nc\td");
  });

  it("selects a column directly even when it is absent from autocomplete suggestions", () => {
    const data = new Map([["G2", "Complete"], ["G3", "Review"], ["G8", "Flagged"], ["A1", "Other"]]);
    expect(populatedColumnSelection(data, 6)).toEqual({
      anchor: { row: 1, column: 6 },
      focus: { row: 7, column: 6 },
    });
  });

  it("clears every cell in a selection", () => {
    const data = new Map([["A1", "one"], ["B1", "two"], ["C1", "three"]]);
    const cleared = clearSelection(data, { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } });
    expect([...cleared]).toEqual([["C1", "three"]]);
  });

  it("evaluates formula cells for display", () => {
    const worksheet = buildWorksheet(new Map([["A1", "10"], ["A2", "20"], ["A3", "=SUM(A1:A2)"]]));
    expect(displayValue(worksheet, { row: 2, column: 0 })).toBe("30");
  });

  it("explains spreadsheet errors", () => {
    expect(formulaErrorMessage("#SPILL!")).toContain("destination cell");
    expect(formulaErrorMessage("42")).toBeUndefined();
  });

  it("validates typed and required cells without blocking formulas", () => {
    expect(validateTypedCell("", "text", true)).toBe("A value is required.");
    expect(validateTypedCell("abc", "number")).toBe("Enter a valid number.");
    expect(validateTypedCell("2026-09-02", "date")).toBeUndefined();
    expect(validateTypedCell("=A1*2", "number", true)).toBeUndefined();
    expect(validateTypedCell("2026-09-02 14:30", "datetime")).toBeUndefined();
    expect(validateTypedCell("2026-09-02T14:30:45", "datetime")).toBeUndefined();
    expect(validateTypedCell("2026-09-02", "datetime")).toBe("Enter a datetime as YYYY-MM-DD HH:MM.");
    expect(validateTypedCell("2026-13-40 25:99", "datetime")).toBe("Enter a datetime as YYYY-MM-DD HH:MM.");
  });

  it("rewrites quoted and unquoted sheet references on rename", () => {
    expect(renameSheetReferences("=SUM(Inputs!A1:A3)", "Inputs", "Raw Data")).toBe("=SUM('Raw Data'!A1:A3)");
    expect(renameSheetReferences("='Raw Data'!B2", "Raw Data", "Inputs")).toBe("=Inputs!B2");
  });

  it("inserts and deletes rows while updating formulas", () => {
    const inserted = changeGridStructure(new Map([["A1", "10"], ["A2", "20"], ["B3", "=SUM(A1:A2)"]]), { axis: "row", index: 1, count: 1, kind: "insert" });
    expect([...inserted]).toEqual([["A1", "10"], ["A3", "20"], ["B4", "=SUM(A1:A3)"]]);
    const deleted = changeGridStructure(inserted, { axis: "row", index: 2, count: 1, kind: "delete" });
    expect(deleted.get("B3")).toBe("=SUM(A1:#REF!)");
  });

  it("leaves function names and string literals intact when adjusting formulas", () => {
    // Insert at index 9 = above row 10: B10→B11, but LOG10 must not become LOG11.
    const moved = changeGridStructure(new Map([
      ["A1", "=LOG10(B10)"],
      ["B1", '="see A1"'],
      ["C1", "=$A$10+'Raw Data'!B10"],
    ]), { axis: "row", index: 9, count: 1, kind: "insert" });
    expect(moved.get("A1")).toBe("=LOG10(B11)");
    expect(moved.get("B1")).toBe('="see A1"');
    expect(moved.get("C1")).toBe("=$A$11+'Raw Data'!B11");
  });

  it("keeps function names intact when shifting formula references", () => {
    expect(shiftFormulaReferences("=LOG10(A1)+ATAN2(A1,B1)", 1, 0)).toBe("=LOG10(A2)+ATAN2(A2,B2)");
    expect(shiftFormulaReferences('="cell A1"&A1', 1, 0)).toBe('="cell A1"&A2');
  });

  it("replaces case-insensitively to match find", () => {
    expect(replaceAllText("Foo foo FOO", "foo", "x")).toEqual({ text: "x x x", count: 3 });
    expect(replaceAllText("keep FooBar whole", "foo", "x")).toEqual({ text: "keep xBar whole", count: 1 });
    expect(replaceAllText("none", "foo", "x")).toEqual({ text: "none", count: 0 });
    expect(replaceAllText("any", "", "x")).toEqual({ text: "any", count: 0 });
  });

  it("inserts columns while updating cell addresses and references", () => {
    const next = changeGridStructure(new Map([["B1", "5"], ["C1", "=B1"]]), { axis: "column", index: 1, count: 1, kind: "insert" });
    expect(next.get("C1")).toBe("5");
    expect(next.get("D1")).toBe("=C1");
  });

  it("sorts complete rows by text or numeric column values", () => {
    const data = new Map([["A1", "second"], ["B1", "20"], ["A2", "first"], ["B2", "3"]]);
    const sorted = sortGridRows(data, 1, "asc");
    expect([...sorted]).toEqual([["A1", "first"], ["B1", "3"], ["A2", "second"], ["B2", "20"]]);
  });

  it("adjusts relative references when formulas move", () => {
    expect(shiftFormulaReferences("=SUM(A1:B2)*C3", 2, 1)).toBe("=SUM(B3:C4)*D5");
    expect(shiftFormulaReferences("=$A$1+A$2+$B3", 2, 1)).toBe("=$A$1+B$2+$B5");
  });

  it("cycles references through Excel absolute forms", () => {
    expect(cycleAbsoluteReference("=SUM(A1:B2)")).toBe("=SUM(A1:$B$2)");
    expect(cycleAbsoluteReference("=$B$2")).toBe("=B$2");
    expect(cycleAbsoluteReference("=B$2")).toBe("=$B2");
    expect(cycleAbsoluteReference("=$B2")).toBe("=B2");
  });

  it("fills a selection and adjusts copied formulas", () => {
    const data = new Map([["A1", "10"], ["B1", "=A1*2"]]);
    const result = fillSelection(
      data,
      { anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } },
      { row: 2, column: 1 },
      10,
      10,
    );
    expect(result.data.get("B2")).toBe("=A2*2");
    expect(result.data.get("B3")).toBe("=A3*2");
  });

  it("fills down from the top row with relative reference shifting (Ctrl+D)", () => {
    const data = new Map([["A1", "5"], ["B1", "=A1*2"]]);
    const result = fillSelection(
      data,
      { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } },
      { row: 2, column: 1 },
      10,
      10,
    );
    expect(result.data.get("A2")).toBe("5");
    expect(result.data.get("B2")).toBe("=A2*2");
    expect(result.data.get("B3")).toBe("=A3*2");
    expect(result.selection).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 1 } });
  });

  it("fills right from the left column with relative reference shifting (Ctrl+R)", () => {
    const data = new Map([["A1", "5"], ["A2", "=A1*2"]]);
    const result = fillSelection(
      data,
      { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } },
      { row: 1, column: 2 },
      10,
      10,
    );
    expect(result.data.get("B1")).toBe("5");
    expect(result.data.get("B2")).toBe("=B1*2");
    expect(result.data.get("C2")).toBe("=C1*2");
  });

  it("continues numeric and date series during fill", () => {
    const numbers = fillSelection(new Map([["A1", "2"], ["A2", "5"]]), { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, { row: 3, column: 0 }, 10, 2);
    expect(numbers.data.get("A3")).toBe("8");
    expect(numbers.data.get("A4")).toBe("11");
    const dates = fillSelection(new Map([["A1", "2026-09-01"], ["A2", "2026-09-02"]]), { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, { row: 3, column: 0 }, 10, 2);
    expect(dates.data.get("A4")).toBe("2026-09-04");
  });

  it("suggests functions and semantic fields while typing formulas", () => {
    const fields = [{ label: "result", column: 3 }, { label: "run_date", column: 5 }];
    const field = formulaSuggestions("=res", 4, fields)[0];
    expect(field).toMatchObject({ label: "result", replacement: "D5", kind: "field" });
    expect(applyFormulaSuggestion("=res", field)).toBe("=D5");
    expect(formulaSuggestions("=av", 0, fields)[0]).toMatchObject({ label: "AVERAGE", replacement: "AVERAGE(" });
  });

  it("inserts and moves a formula reference with arrow keys", () => {
    const editing = { row: 5, column: 2 };
    const first = moveFormulaReference(null, editing, { row: -1, column: 0 }, false, 100, 20, 1);
    expect(applyFormulaReference("=", first)).toBe("=C5");
    const second = moveFormulaReference(first, editing, { row: -1, column: 0 }, false, 100, 20, 4);
    expect(applyFormulaReference("=C5", second)).toBe("=C4");
  });

  it("extends a formula range with shift-arrow after a function", () => {
    const editing = { row: 5, column: 2 };
    const first = moveFormulaReference(null, editing, { row: -1, column: 0 }, false, 100, 20, 5);
    const extended = moveFormulaReference(first, editing, { row: -1, column: 0 }, true, 100, 20, 5);
    expect(applyFormulaReference("=SUM(", extended)).toBe("=SUM(C5:C4");
  });

  it("represents a formula range as one rectangular outline", () => {
    const ranges = formulaReferenceRanges("=SUM(B2:D5)+F3");
    expect(ranges).toHaveLength(2);
    expect(normaliseSelection(ranges[0])).toEqual({ top: 1, bottom: 4, left: 1, right: 3 });
    expect(normaliseSelection(ranges[1])).toEqual({ top: 2, bottom: 2, left: 5, right: 5 });
  });

  it("suggests populated regions for aggregate formulas", () => {
    const regions = [
      { label: "B2:B8", detail: "Result · 7 populated cells" },
      { label: "C2:C8", detail: "Assay · 7 populated cells" },
    ];
    const completed = formulaSuggestions("=SUM", 8, [], regions);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      label: "SUM(B2:B8)", replacement: "SUM(B2:B8)", kind: "region",
    });
    const open = formulaSuggestions("=SUM(", 8, [], regions);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      label: "B2:B8", replacement: "B2:B8)", kind: "region",
    });
  });

  it("closes an aggregate formula after selecting its range", () => {
    expect(completeFormula("=SUM(D2:D9")).toBe("=SUM(D2:D9)");
    expect(completeFormula("=IF(A1>0,SUM(B1:B3)")).toBe("=IF(A1>0,SUM(B1:B3))");
    expect(completeFormula("plain text")).toBe("plain text");
  });

  it("preserves protected cells during bulk operations", () => {
    const canEdit = ({ row }: { row: number }) => row !== 0;
    const data = new Map([["A1", "field"], ["A2", "value"]]);
    const cleared = clearSelection(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, canEdit);
    expect(cleared.get("A1")).toBe("field");
    expect(cleared.has("A2")).toBe(false);
    const pasted = pasteTsv(data, { row: 0, column: 0 }, "changed\nnew", 10, 10, canEdit);
    expect(pasted.data.get("A1")).toBe("field");
    expect(pasted.data.get("A2")).toBe("new");
  });

  it("splits and applies TSV rows in chunks equivalent to a single paste", () => {
    const tsv = "a\tb\nc\td";
    const rows = parseTsv(tsv);
    expect(rows).toEqual([["a", "b"], ["c", "d"]]);
    const data = new Map([["A1", "keep"]]);
    const whole = pasteTsv(data, { row: 1, column: 0 }, tsv, 10, 10);
    const first = applyTsvRows(data, { row: 1, column: 0 }, rows.slice(0, 1), 10, 10);
    const second = applyTsvRows(first.data, { row: 2, column: 0 }, rows.slice(1), 10, 10);
    expect(second.data).toEqual(whole.data);
    expect(whole.selection.focus).toEqual({ row: 2, column: 1 });
    expect(second.selection.focus).toEqual({ row: 2, column: 1 });
  });

  it("accepts comma-joined option values while validating", () => {
    const options = ["Complete", "Review", "Flagged"];
    expect(validateTypedCell("Complete", "text", false, options)).toBeUndefined();
    expect(validateTypedCell("Complete, Review", "text", false, options)).toBeUndefined();
    expect(validateTypedCell("Complete, Bogus", "text", false, options)).toContain("Choose one of");
  });

  it("jumps to the far edge of a populated run (Ctrl+Arrow)", () => {
    // Column A: A1-A3 populated, A4 empty, A5-A6 populated, rest empty.
    const hasValue = (address: string) => ["A1", "A2", "A3", "A5", "A6"].includes(address);
    // Inside a run → last populated cell of that run.
    expect(edgeOfData(hasValue, { row: 0, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 2, column: 0 });
    // On the edge of a run, next cell empty → first populated cell of the next run.
    expect(edgeOfData(hasValue, { row: 2, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 4, column: 0 });
    // Inside the last run → its last populated cell; from there → grid edge.
    expect(edgeOfData(hasValue, { row: 4, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 5, column: 0 });
    expect(edgeOfData(hasValue, { row: 5, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 19, column: 0 });
    // Upward out of the top run → row 0.
    expect(edgeOfData(hasValue, { row: 2, column: 0 }, { row: -1, column: 0 }, 20, 5)).toEqual({ row: 0, column: 0 });
    // From an empty cell over empty space → grid edge.
    expect(edgeOfData(hasValue, { row: 9, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 19, column: 0 });
    // At the edge already → stays put.
    expect(edgeOfData(hasValue, { row: 19, column: 0 }, { row: 1, column: 0 }, 20, 5)).toEqual({ row: 19, column: 0 });
  });

  it("bounds the used range and ignores non-cell keys", () => {
    const data = new Map([["B2", "x"], ["D5", "y"], ["meta:note", "nope"], ["A9", ""]]);
    expect(usedRangeBounds(data)).toEqual({ top: 1, left: 1, bottom: 4, right: 3 });
    expect(usedRangeBounds(new Map())).toBeUndefined();
    expect(usedRangeBounds(new Map([["A1", ""]]))).toBeUndefined();
  });

  it("moves a range of values and reselects the destination", () => {
    const data = new Map([["A1", "one"], ["B1", "two"], ["C3", "other"]]);
    const moved = moveRange(
      data,
      { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } },
      { row: 2, column: 1 },
      10,
      10,
    );
    expect(moved).toBeDefined();
    expect(moved?.data.get("A1")).toBeUndefined();
    expect(moved?.data.get("B1")).toBeUndefined();
    expect(moved?.data.get("B3")).toBe("one");
    expect(moved?.data.get("C3")).toBe("two");
    expect(moved?.selection).toEqual({ anchor: { row: 2, column: 1 }, focus: { row: 2, column: 2 } });
    // Dropping on the origin is a no-op.
    expect(moveRange(data, { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } }, { row: 0, column: 0 }, 10, 10)).toBeUndefined();
  });

  it("keeps a move consistent when source and destination overlap", () => {
    const data = new Map([["A1", "one"], ["A2", "two"]]);
    const moved = moveRange(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, { row: 1, column: 0 }, 10, 10);
    expect(moved?.data.get("A1")).toBeUndefined();
    expect(moved?.data.get("A2")).toBe("one");
    expect(moved?.data.get("A3")).toBe("two");
  });

  it("aggregates a selection for the status bar", () => {
    const data = new Map([["A1", "10"], ["A2", "20"], ["B1", "text"], ["B2", ""], ["C1", "-5"]]);
    const aggregates = selectionAggregates(data, { anchor: { row: 0, column: 0 }, focus: { row: 2, column: 2 } });
    expect(aggregates.count).toBe(4);
    expect(aggregates.numeric).toBe(3);
    expect(aggregates.sum).toBe(25);
    expect(aggregates.min).toBe(-5);
    expect(aggregates.max).toBe(20);
    // Cells outside the selection are excluded.
    const partial = selectionAggregates(data, { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
    expect(partial.count).toBe(1);
    expect(partial.sum).toBe(10);
  });

  it("resolves displayed coordinates through a view's key resolver", () => {
    // Displayed row 0 shows stored row 2; displayed row 1 shows stored row 1.
    const keyFor = (point: { row: number; column: number }) => `A${point.row === 0 ? 2 : 1}`;
    const data = new Map([["A1", "one"], ["A2", "two"]]);
    const pasted = pasteTsv(data, { row: 0, column: 0 }, "changed", 2, 1, () => true, keyFor);
    expect(pasted.data.get("A2")).toBe("changed");
    expect(pasted.data.get("A1")).toBe("one");
    expect(selectionToTsv(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, keyFor)).toBe("two\none");
    expect(selectionAddresses({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, keyFor)).toEqual(["A2", "A1"]);
    const aggregates = selectionAggregates(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, undefined, keyFor);
    expect(aggregates.count).toBe(2);
  });

  it("lists the intended paste targets without the editable filter", () => {
    const data = new Map([["A1", "field"], ["A2", "value"]]);
    expect(pasteTargetChanges(data, { row: 0, column: 0 }, [["changed"], ["new"]], 10, 10)).toEqual([
      { address: "A1", before: "field", after: "changed" },
      { address: "A2", before: "value", after: "new" },
    ]);
    // Unchanged cells and out-of-bounds cells are not targets.
    expect(pasteTargetChanges(data, { row: 0, column: 0 }, [["field"]], 1, 10)).toEqual([]);
  });

  it("lists the populated cells a clear would empty", () => {
    const data = new Map([["A1", "one"], ["B2", "two"]]);
    expect(clearRangeTargets(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } })).toEqual([
      { address: "A1", before: "one", after: undefined },
      { address: "B2", before: "two", after: undefined },
    ]);
  });

  it("reports fill targets the grid will not write", () => {
    const data = new Map([["A1", "x"], ["A2", "y"]]);
    const canEdit = (point: { row: number }) => point.row !== 3;
    const filled = fillSelection(data, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }, { row: 3, column: 0 }, 10, 1, canEdit);
    expect(filled.data.get("A3")).toBe("x");
    expect(filled.data.get("A4")).toBeUndefined();
    expect(filled.intended).toEqual([
      { address: "A3", before: undefined, after: "x" },
      { address: "A4", before: undefined, after: "y" },
    ]);
  });

  it("reports move targets for both the source and the destination", () => {
    const data = new Map([["A1", "one"]]);
    const moved = moveRange(data, { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }, { row: 2, column: 0 }, 10, 10);
    expect(moved?.intended).toEqual([
      { address: "A1", before: "one", after: undefined },
      { address: "A3", before: undefined, after: "one" },
    ]);
  });

});
