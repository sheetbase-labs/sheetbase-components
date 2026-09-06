import { describe, expect, it } from "vitest";
import { materializeDatasetPage } from "./projection";

describe("materializeDatasetPage", () => {
  it("projects page offsets into stable record-field cells", () => {
    const cells = materializeDatasetPage({
      request: { datasetId: "experiments", rowStart: 100, rowCount: 50, fieldIds: ["id", "result"], queryKey: "all" },
      totalRows: 1_000,
      revision: "r1",
      records: [{ recordId: "exp-101", values: { id: "EXP-101", result: 18.4 } }],
    }, [{ column: 0, fieldId: "id" }, { column: 3, fieldId: "result" }]);
    expect(cells.get("A101")).toEqual({
      display: "EXP-101",
      binding: { kind: "record-field", datasetId: "experiments", recordId: "exp-101", fieldId: "id" },
    });
    expect(cells.get("D101")?.display).toBe("18.4");
  });
});
