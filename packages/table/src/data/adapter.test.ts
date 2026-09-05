import { describe, expect, it } from "vitest";
import type { CellBinding } from "../engine";
import { cellMutation } from "../grid/mutations";
import { recordWritesForMutation } from "./adapter";

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
