import { describe, expect, it } from "vitest";
import {
  annotationForCell,
  normaliseCellAnnotations,
  removeAnnotation,
  setAnnotation,
  type CellAnnotation,
} from "./annotations";

describe("setAnnotation", () => {
  it("stores recordId+fieldId when both are given", () => {
    const next = setAnnotation([], "C5", "re-run March 3", { recordId: "r1", fieldId: "status", bound: true });
    expect(next).toEqual([{ address: "C5", recordId: "r1", fieldId: "status", text: "re-run March 3" }]);
  });

  it("replaces the same record pair at a different address (re-annotate after re-sort)", () => {
    const existing = setAnnotation([], "C5", "old", { recordId: "r1", fieldId: "status", bound: true });
    const next = setAnnotation(existing, "C9", "new", { recordId: "r1", fieldId: "status", bound: true });
    expect(next).toEqual([{ address: "C9", recordId: "r1", fieldId: "status", text: "new" }]);
  });

  it("a bound write without identity keeps record-keyed entries at the same address", () => {
    const existing: CellAnnotation[] = [{ address: "C5", recordId: "r1", fieldId: "status", text: "record note" }];
    const next = setAnnotation(existing, "C5", "free-column note", { bound: true });
    expect(next).toEqual([
      { address: "C5", recordId: "r1", fieldId: "status", text: "record note" },
      { address: "C5", text: "free-column note" },
    ]);
  });

  it("unbound writes replace whatever sits at the address (legacy behaviour)", () => {
    const existing: CellAnnotation[] = [{ address: "C5", text: "old" }];
    expect(setAnnotation(existing, "C5", "new")).toEqual([{ address: "C5", text: "new" }]);
  });

  it("empty text removes rather than stores", () => {
    const existing = setAnnotation([], "C5", "note", { recordId: "r1", fieldId: "status", bound: true });
    expect(setAnnotation(existing, "C5", "  ", { recordId: "r1", fieldId: "status", bound: true })).toEqual([]);
  });
});

describe("annotationForCell", () => {
  const annotations: CellAnnotation[] = [
    { address: "C9", recordId: "r1", fieldId: "status", text: "record note" },
    { address: "C5", text: "sheet note" },
  ];

  it("prefers (recordId, fieldId) over the cell's address", () => {
    // Record r1 now renders at C5 — record match wins even though the stored
    // address is stale and an unrelated address note also sits there.
    const withBoth = [...annotations, { address: "C5", text: "at C5" }];
    expect(annotationForCell(withBoth, { address: "C5", recordId: "r1", fieldId: "status", bound: true })?.text).toBe("record note");
  });

  it("follows the record to its new address (the re-sort bug)", () => {
    expect(annotationForCell(annotations, { address: "C9", recordId: "r1", fieldId: "status", bound: true })?.text).toBe("record note");
  });

  it("never lands a record-keyed note on a different record via stale address", () => {
    // A different record now occupies C9 (the note's stored address).
    expect(annotationForCell(annotations, { address: "C9", recordId: "r2", fieldId: "status", bound: true })).toBeUndefined();
  });

  it("bound cells fall back to address-keyed entries only", () => {
    expect(annotationForCell(annotations, { address: "C5", recordId: "r2", fieldId: "status", bound: true })?.text).toBe("sheet note");
    // A bound cell that resolved no record (blank row) still skips stale addresses.
    expect(annotationForCell(annotations, { address: "C9", bound: true })).toBeUndefined();
  });

  it("unbound cells match on address", () => {
    expect(annotationForCell(annotations, { address: "C5" })?.text).toBe("sheet note");
    // Unbound has no record identity — a record-keyed note resolves by its stored address.
    expect(annotationForCell(annotations, { address: "C9" })?.text).toBe("record note");
  });
});

describe("removeAnnotation", () => {
  it("removes a record-keyed note at its current address", () => {
    const annotations = setAnnotation([], "C5", "note", { recordId: "r1", fieldId: "status", bound: true });
    // The record re-sorted to row 9; removing at C9 must still hit it.
    expect(removeAnnotation(annotations, { address: "C9", recordId: "r1", fieldId: "status", bound: true })).toEqual([]);
  });

  it("a bound address ref does not remove a record-keyed note by stale address", () => {
    const annotations: CellAnnotation[] = [{ address: "C5", recordId: "r1", fieldId: "status", text: "note" }];
    expect(removeAnnotation(annotations, { address: "C5", bound: true })).toEqual(annotations);
  });

  it("string form keeps the legacy address-only behaviour", () => {
    const annotations: CellAnnotation[] = [{ address: "C5", text: "note" }];
    expect(removeAnnotation(annotations, "C5")).toEqual([]);
  });
});

describe("normaliseCellAnnotations", () => {
  it("round-trips the record identity fields", () => {
    const stored = [{ address: "C5", recordId: "r1", fieldId: "status", text: "note", author: "g" }];
    expect(normaliseCellAnnotations(stored)).toEqual(stored);
  });

  it("strips a half-keyed pair rather than storing an unresolvable identity", () => {
    expect(normaliseCellAnnotations([{ address: "C5", recordId: "r1", text: "note" }])).toEqual([{ address: "C5", text: "note" }]);
    expect(normaliseCellAnnotations([{ address: "C5", fieldId: "status", text: "note" }])).toEqual([{ address: "C5", text: "note" }]);
  });
});
