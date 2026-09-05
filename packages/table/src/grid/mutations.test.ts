import { describe, expect, it } from "vitest";
import { RangeStore, Worksheet } from "../engine";
import type { CellFormat } from "../engine";
import { applyCellMutation, applyColumnWidthMutation, applyWorksheetMutation, auditedMutation, cellChangesMutation, cellMutation, columnWidthMutation, emitMutationAudit, formatMutation, mutationFormat, type AuditedMutation } from "./mutations";

describe("grid mutations", () => {
  it("stores only changed cells and applies both directions", () => {
    const before = new Map([["A1", "one"], ["B1", "same"]]);
    const after = new Map([["A1", "two"], ["B1", "same"], ["C1", "new"]]);
    const mutation = cellMutation("Edit", before, after);
    expect(mutation.cells).toHaveLength(2);
    expect([...applyCellMutation(before, mutation)]).toEqual([...after]);
    expect([...applyCellMutation(after, mutation, "backward")]).toEqual([...before]);
  });

  it("reverses format and column-width mutations", () => {
    const before = new RangeStore<CellFormat>();
    const after = before.clone();
    after.write({ start: { row: 0, column: 0 }, end: { row: 4, column: 0 } }, { fontWeight: 600 });
    const formatting = formatMutation("Bold", before, after);
    expect(mutationFormat(after, formatting, "backward").get({ row: 2, column: 0 })).toBeUndefined();
    const resizing = columnWidthMutation({ column: 1, before: 100, after: 180 });
    expect(applyColumnWidthMutation([100, 100], resizing)).toEqual([100, 180]);
    expect(applyColumnWidthMutation([100, 180], resizing, "backward")).toEqual([100, 100]);
  });

  it("updates a persistent worksheet in both directions", () => {
    const worksheet = new Worksheet();
    worksheet.setInput("A1", "10");
    worksheet.setInput("B1", "=A1*2");
    const mutation = cellMutation("Edit", new Map([["A1", "10"]]), new Map([["A1", "20"]]));
    applyWorksheetMutation(worksheet, mutation);
    expect(worksheet.value("B1")).toBe(40);
    applyWorksheetMutation(worksheet, mutation, "backward");
    expect(worksheet.value("B1")).toBe(20);
  });
});

describe("mutation audit sink", () => {
  it("stamps commit and undo applications with exactly one record each", () => {
    const seen: AuditedMutation[] = [];
    const forward = cellChangesMutation("Edit cell", [{ address: "A1", before: "one", after: "two" }]);
    emitMutationAudit((mutation) => { seen.push(mutation); }, forward, "r7");
    emitMutationAudit((mutation) => { seen.push(mutation); }, forward, "r7");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ label: "Edit cell", revision: "r7" });
    expect(seen[0]!.cells).toEqual([{ address: "A1", before: "one", after: "two" }]);
    for (const record of seen) expect(typeof record.at).toBe("string");
    expect(new Date(seen[0]!.at).getTime()).not.toBeNaN();
  });

  it("never blocks the commit when the sink throws or is absent", () => {
    const mutation = cellChangesMutation("Edit cell", [{ address: "A1", before: "one", after: "two" }]);
    expect(() => emitMutationAudit(() => { throw new Error("sink down"); }, mutation)).not.toThrow();
    expect(() => emitMutationAudit(undefined, mutation)).not.toThrow();
    const stamped = auditedMutation(mutation);
    expect(stamped.revision).toBeUndefined();
    expect(stamped).not.toBe(mutation);
  });
});
