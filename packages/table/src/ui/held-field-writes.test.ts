import { describe, expect, it } from "vitest";
import {
  clearHeldFieldWrites,
  holdFieldWrite,
} from "./held-field-writes";
import type { FieldWrite } from "./Spreadsheet";

const write = (address: string, value: string): FieldWrite => ({
  address,
  row: 0,
  datasetId: "ds",
  recordId: "rec",
  fieldId: "f",
  value,
});

describe("held field-write registry", () => {
  it("replaces a held write when the same cell is re-edited", () => {
    let held = holdFieldWrite(new Map(), write("B2", "first"), "old");
    held = holdFieldWrite(held, write("B2", "second"), "old");
    expect(held.size).toBe(1);
    expect(held.get("B2")?.write.value).toBe("second");
    expect(held.get("B2")?.before).toBe("old");
  });

  it("keeps distinct cells distinct", () => {
    let held = holdFieldWrite(new Map(), write("B2", "a"));
    held = holdFieldWrite(held, write("C2", "b"));
    expect(held.size).toBe(2);
  });

  it("clears completely", () => {
    let held = holdFieldWrite(new Map(), write("B2", "a"));
    held = clearHeldFieldWrites();
    expect(held.size).toBe(0);
  });
});
