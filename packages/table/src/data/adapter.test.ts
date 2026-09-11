import { describe, expect, it } from "vitest";
import type { CellBinding } from "../engine";
import { cellChangesMutation, cellMutation } from "../grid/mutations";
import { fieldWritesForMutation, recordWritesForMutation, type MutationWriteHeader } from "./adapter";

describe("record bindings", () => {
  it("converts grid edits into identity-preserving record writes", () => {
    const mutation = cellMutation("Edit", new Map([["D2", "18.4"]]), new Map([["D2", "19.1"], ["H2", "=D2*2"]]));
    const bindings = new Map<string, CellBinding>([["D2", {
      kind: "record-field",
      datasetId: "experiments",
      recordId: "exp-1048",
      fieldId: "result",
    }]]);
    expect(recordWritesForMutation(mutation, bindings)).toEqual([{
      datasetId: "experiments",
      recordId: "exp-1048",
      fieldId: "result",
      before: "18.4",
      after: "19.1",
    }]);
  });
});

describe("fieldWritesForMutation", () => {
  const recordIds = new Map([[0, "r1"], [1, "r2"], [2, "r3"]]);
  const header: MutationWriteHeader = {
    datasetId: "experiments",
    recordIdForRow: (row) => recordIds.get(row),
    fields: [
      { id: "status", column: 0 },
      { id: "result", column: 1 },
      { id: "locked", column: 2, writable: false },
    ],
  };

  it("emits one write per bound cell with row→record identity", () => {
    const mutation = cellChangesMutation("Paste range", [
      { address: "A1", before: "Open", after: "Done" },
      { address: "B1", before: "1.0", after: "2.0" },
      { address: "A2", before: "Open", after: "Done" },
    ]);
    expect(fieldWritesForMutation(mutation, header)).toEqual([
      { write: { address: "A1", row: 0, datasetId: "experiments", recordId: "r1", fieldId: "status", value: "Done" }, before: "Open" },
      { write: { address: "B1", row: 0, datasetId: "experiments", recordId: "r1", fieldId: "result", value: "2.0" }, before: "1.0" },
      { write: { address: "A2", row: 1, datasetId: "experiments", recordId: "r2", fieldId: "status", value: "Done" }, before: "Open" },
    ]);
  });

  it("cleared cells write the empty string", () => {
    const mutation = cellChangesMutation("Clear range", [{ address: "B2", before: "9.9", after: undefined }]);
    expect(fieldWritesForMutation(mutation, header)).toEqual([
      { write: { address: "B2", row: 1, datasetId: "experiments", recordId: "r2", fieldId: "result", value: "" }, before: "9.9" },
    ]);
  });

  it("produces no writes without a bound header", () => {
    const mutation = cellChangesMutation("Paste", [{ address: "A1", before: "x", after: "y" }]);
    expect(fieldWritesForMutation(mutation, undefined)).toEqual([]);
  });

  it("skips cells without record identity and non-writable fields", () => {
    const mutation = cellChangesMutation("Paste", [
      { address: "C1", before: "x", after: "y" },   // writable: false field
      { address: "A9", before: undefined, after: "y" }, // row with no loaded record
      { address: "A1", before: "x", after: "y" },
    ]);
    const writes = fieldWritesForMutation(mutation, header);
    expect(writes.map((entry) => entry.write.address)).toEqual(["A1"]);
  });

  it("ignores malformed cell keys", () => {
    const mutation = cellChangesMutation("Paste", [{ address: "not-a-cell", before: "x", after: "y" }]);
    expect(fieldWritesForMutation(mutation, header)).toEqual([]);
  });
});
