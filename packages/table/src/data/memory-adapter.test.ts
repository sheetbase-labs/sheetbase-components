import { describe, expect, it } from "vitest";
import type { FilterOperator, GroupNode } from "./query";
import { createMemoryPagedAdapter, type MemoryDatasetRow } from "./memory-adapter";

const rows: MemoryDatasetRow[] = [
  { recordId: "r1", values: { status: "Complete", assay: "p24 ELISA", result: 12.5 } },
  { recordId: "r2", values: { status: "Review", assay: "BCA", result: 4 } },
  { recordId: "r3", values: { status: "Flagged", assay: "HCP", result: 99 } },
  { recordId: "r4", values: { status: "Complete", assay: "HCP", result: 1.5 } },
];

const pageRequest = (filterTree: GroupNode) => ({
  datasetId: "d",
  rowStart: 0,
  rowCount: 10,
  fieldIds: ["status", "assay", "result"],
  queryKey: "tree",
  filterTree,
});

const group = (combinator: GroupNode["combinator"], children: GroupNode["children"], id = "g"): GroupNode =>
  ({ type: "group", id, combinator, children });
const cond = (field: string, operator: FilterOperator = "eq", value: unknown = "x", id = field) =>
  ({ type: "condition" as const, id, field, operator, value });

describe("createMemoryPagedAdapter filterTree", () => {
  it("evaluates a NOT group with none-match semantics", async () => {
    const adapter = createMemoryPagedAdapter(rows);
    const page = await adapter.fetchPage(pageRequest(group("NOT", [cond("status", "eq", "Complete")])));
    expect(page.records.map((record) => record.recordId)).toEqual(["r2", "r3"]);
  });

  it("evaluates a nested AND(OR(..)) tree that flat filters cannot express", async () => {
    const adapter = createMemoryPagedAdapter(rows);
    const tree = group("AND", [
      cond("assay", "eq", "HCP"),
      group("OR", [cond("status", "eq", "Flagged"), cond("result", "lt", 2, "r")], "inner"),
    ]);
    const page = await adapter.fetchPage(pageRequest(tree));
    // r3: HCP + Flagged; r4: HCP + result 1.5 < 2. r1 is Complete but result 12.5.
    expect(page.records.map((record) => record.recordId)).toEqual(["r3", "r4"]);
  });

  it("is authoritative over flat filters when both are present", async () => {
    const adapter = createMemoryPagedAdapter(rows);
    const page = await adapter.fetchPage({
      ...pageRequest(group("NOT", [cond("status", "eq", "Complete")])),
      filters: [{ fieldId: "status", operator: "eq", value: "Complete" }],
      filterLogic: "and",
    });
    expect(page.records.map((record) => record.recordId)).toEqual(["r2", "r3"]);
  });
});
