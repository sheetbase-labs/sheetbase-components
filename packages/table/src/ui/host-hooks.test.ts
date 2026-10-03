import { describe, expect, it, vi } from "vitest";
import type { GridMutation } from "../grid/mutations";
import {
  buildCellChanges,
  cellDisplayText,
  enabledMenuActions,
  resolveBeforeCellsChange,
  resolveClipboardPayload,
  sameClauses,
  selectCustomEditor,
  type SpreadsheetClipboardPayload,
} from "./host-hooks";

const mutation = (cells: GridMutation["cells"]): GridMutation => ({ label: "Edit cell", cells, columnWidths: [] });

/** A bulk mutation: the applied cells plus the operation's full target set. */
const bulk = (intended: GridMutation["intended"], cells: GridMutation["cells"]): GridMutation =>
  ({ label: "Paste range", cells, intended, columnWidths: [] });

const header = {
  recordIdForRow: (row: number) => `rec-${row}`,
  fields: [
    { id: "amount", column: 1 },
    { id: "name", column: 0 },
  ],
};

describe("beforeCellsChange pre-commit gate", () => {
  it("accepts the mutation unchanged when the hook returns nothing", () => {
    const hook = vi.fn();
    const input = mutation([{ address: "A1", before: "1", after: "2" }]);
    expect(resolveBeforeCellsChange(hook, input, "edit", header)).toBe(input);
    expect(hook).toHaveBeenCalledOnce();
  });

  it("rejects the whole change set before it is applied", () => {
    const input = mutation([{ address: "B2", before: "1", after: "2" }, { address: "B3", before: "3", after: "4" }]);
    const result = resolveBeforeCellsChange(() => false, input, "paste", header);
    expect(result).toBeUndefined();
  });

  it("lets the host replace proposed values", () => {
    const input = mutation([
      { address: "B2", before: "1", after: "2" },
      { address: "B3", before: "3", after: "4" },
    ]);
    const result = resolveBeforeCellsChange((changes) => {
      changes[0].next = "20";
      changes[1].next = undefined;
    }, input, "fill", header);
    expect(result?.cells).toEqual([
      { address: "B2", before: "1", after: "20" },
      { address: "B3", before: "3", after: undefined },
    ]);
  });

  it("hands the host bound identity and the write source", () => {
    const seen: unknown[] = [];
    resolveBeforeCellsChange((changes, source) => {
      seen.push(source, changes);
    }, mutation([{ address: "A1", before: undefined, after: "x" }]), "paste", header);
    expect(seen[0]).toBe("paste");
    expect(seen[1]).toEqual([{ address: "A1", row: 0, column: 0, recordId: "rec-0", fieldId: "name", before: undefined, next: "x" }]);
  });

  it("bypasses the gate for mutations with no cell changes", () => {
    const hook = vi.fn();
    const input = mutation([]);
    expect(resolveBeforeCellsChange(hook, input, "sort", header)).toBe(input);
    expect(hook).not.toHaveBeenCalled();
  });

  it("builds changes in mutation order", () => {
    expect(buildCellChanges(mutation([{ address: "C3", after: "9" }]), header)).toEqual([
      { address: "C3", row: 2, column: 2, recordId: "rec-2", fieldId: undefined, before: undefined, next: "9" },
    ]);
  });
});

describe("intended target set (whole-operation veto)", () => {
  const targets: GridMutation["intended"] = [
    { address: "B2", before: "1", after: "2" },
    { address: "B3", before: undefined, after: "3" },
  ];

  it("reports a target the grid will skip as editable: false", () => {
    const input = bulk(targets, [{ address: "B2", before: "1", after: "2" }]);
    expect(buildCellChanges(input, header)).toEqual([
      { address: "B2", row: 1, column: 1, recordId: "rec-1", fieldId: "amount", before: "1", next: "2" },
      { address: "B3", row: 2, column: 1, recordId: "rec-2", fieldId: "amount", before: undefined, next: "3", editable: false },
    ]);
  });

  it("gates a target set that applies no cells and rejects it as a whole", () => {
    const hook = vi.fn(() => false);
    const input = bulk([{ address: "B2", before: "1", after: "2" }], []);
    expect(resolveBeforeCellsChange(hook, input, "clear", header)).toBeUndefined();
    expect(hook).toHaveBeenCalledOnce();
  });

  it("lets the host veto a bulk operation because of a skip-only target", () => {
    const input = bulk(targets, [{ address: "B2", before: "1", after: "2" }]);
    const seen: unknown[] = [];
    const rejected = resolveBeforeCellsChange((changes, source) => {
      seen.push([source, changes]);
      return changes.every((change) => change.editable !== false);
    }, input, "paste", header);
    expect(rejected).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it("applies host value replacements to the writable subset only", () => {
    const input = bulk(targets, [{ address: "B2", before: "1", after: "2" }]);
    const result = resolveBeforeCellsChange((changes) => {
      changes[0].next = "20";
      changes[1].next = "30";
    }, input, "paste", header);
    expect(result?.cells).toEqual([{ address: "B2", before: "1", after: "20" }]);
  });

  it("bypasses the gate when a mutation carries neither cells nor targets", () => {
    const hook = vi.fn();
    const input = bulk(undefined, []);
    expect(resolveBeforeCellsChange(hook, input, "sort", header)).toBe(input);
    expect(hook).not.toHaveBeenCalled();
  });
});

const payload = (text: string): SpreadsheetClipboardPayload => ({
  text,
  values: text.split("\n").map((row) => row.split("\t")),
  range: { top: 0, left: 0, bottom: 0, right: 1, columnIds: ["name", "amount"] },
});

describe("clipboard hooks", () => {
  it("passes the payload through when the host accepts", () => {
    const input = payload("a\tb");
    expect(resolveClipboardPayload(undefined, input)).toBe(input);
    expect(resolveClipboardPayload(true, input)).toBe(input);
  });

  it("cancels copy/cut/paste when the host rejects", () => {
    expect(resolveClipboardPayload(false, payload("a\tb"))).toBeUndefined();
  });

  it("re-parses values and keeps the range when the host transforms the text", () => {
    const input = payload("a\tb");
    const resolved = resolveClipboardPayload({ ...input, text: "x\ty\nz\tw" }, input);
    expect(resolved?.text).toBe("x\ty\nz\tw");
    expect(resolved?.values).toEqual([["x", "y"], ["z", "w"]]);
    expect(resolved?.range).toBe(input.range);
  });

  it("honours a host-supplied range", () => {
    const input = payload("a\tb");
    const range = { top: 5, left: 2, bottom: 5, right: 3, columnIds: ["c", "d"] };
    const resolved = resolveClipboardPayload({ ...input, range }, input);
    expect(resolved?.range).toEqual(range);
  });
});

describe("column header menu hook", () => {
  it("drops disabled entries and keeps the rest in order", () => {
    const a = { label: "A", disabled: undefined, onSelect: () => {} };
    const b = { label: "B", disabled: () => true, onSelect: () => {} };
    const c = { label: "C", disabled: () => false, onSelect: () => {} };
    expect(enabledMenuActions([a, b, c])).toEqual([a, c]);
    expect(enabledMenuActions(undefined)).toEqual([]);
  });
});

describe("custom editor hook", () => {
  const recordPicker = { matches: (context: { columnId?: string }) => context.columnId === "owner" };

  it("selects the first editor matching the column id", () => {
    expect(selectCustomEditor([recordPicker], { point: { row: 0, column: 0 }, columnId: "owner" })).toBe(recordPicker);
    expect(selectCustomEditor([recordPicker], { point: { row: 0, column: 0 }, columnId: "amount" })).toBeUndefined();
    expect(selectCustomEditor(undefined, { point: { row: 0, column: 0 }, columnId: "owner" })).toBeUndefined();
  });
});

describe("stored value vs display text", () => {
  it("renders the host label while the stored value is untouched", () => {
    const column = { displayText: (stored: string) => (stored === "rec-7" ? "Sample S-15" : undefined) };
    expect(cellDisplayText(column, "rec-7", "rec-7")).toBe("Sample S-15");
  });

  it("falls back to the built-in formatting when the host declines", () => {
    const column = { displayText: () => undefined };
    expect(cellDisplayText(column, "rec-7", "rec-7")).toBe("rec-7");
    expect(cellDisplayText(undefined, "12", "12.00")).toBe("12.00");
  });
});

describe("sort/filter notification surface", () => {
  it("compares clause lists structurally", () => {
    expect(sameClauses([{ fieldId: "a", direction: "asc" }], [{ fieldId: "a", direction: "asc" }])).toBe(true);
    expect(sameClauses([{ fieldId: "a", direction: "asc" }], [{ fieldId: "a", direction: "desc" }])).toBe(false);
    expect(sameClauses(undefined, [])).toBe(true);
    expect(sameClauses(undefined, [{ fieldId: "a", direction: "asc" }])).toBe(false);
    expect(sameClauses([{ fieldId: "a" }, { fieldId: "b" }], [{ fieldId: "a" }])).toBe(false);
  });
});
