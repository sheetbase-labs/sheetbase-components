import { describe, expect, it } from "vitest";
import type { DataAdapter, RecordFieldWrite } from "./adapter";
import { conflictKey, conflictRows, conflictWriteKeys, RevisionConflictError, RevisionedCommitCoordinator } from "./conflicts";

const write: RecordFieldWrite = { datasetId: "d", recordId: "r", fieldId: "status", before: "Open", after: "Done" };
describe("RevisionedCommitCoordinator", () => {
  it("advances revisions only after accepted commits", async () => {
    const adapter = { resolve: () => null, commit: async (_writes: readonly RecordFieldWrite[], base?: string) => ({ revision: `${base}-next`, accepted: [write], rejected: [] }) } as DataAdapter;
    const coordinator = new RevisionedCommitCoordinator(adapter, "r1");
    expect((await coordinator.commit([write])).status).toBe("committed");
    expect(coordinator.revision).toBe("r1-next");
  });
  it("returns inspectable conflicts without silently retrying", async () => {
    const adapter = { resolve: () => null, commit: async () => { throw new RevisionConflictError("r2", [{ write, serverValue: "Review", reason: "changed" }]); } } as DataAdapter;
    const coordinator = new RevisionedCommitCoordinator(adapter, "r1");
    expect(await coordinator.commit([write])).toMatchObject({ status: "conflict", baseRevision: "r1", currentRevision: "r2" });
    expect(coordinator.revision).toBe("r1");
  });

  it("does not rewind to an older numeric-suffixed revision", () => {
    const adapter = { resolve: () => null, commit: async () => ({ revision: "r1", accepted: [], rejected: [] }) } as DataAdapter;
    const coordinator = new RevisionedCommitCoordinator(adapter, "r5");
    coordinator.acceptRevision("r3");
    expect(coordinator.revision).toBe("r5");
    coordinator.acceptRevision("r9");
    expect(coordinator.revision).toBe("r9");
  });

  it("accepts the first revision and still overwrites for unparseable formats", () => {
    const adapter = { resolve: () => null, commit: async () => ({ revision: "1", accepted: [], rejected: [] }) } as DataAdapter;
    const coordinator = new RevisionedCommitCoordinator(adapter);
    coordinator.acceptRevision("r3");
    expect(coordinator.revision).toBe("r3");
    coordinator.acceptRevision("abc");
    expect(coordinator.revision).toBe("abc");
    coordinator.acceptRevision("r1");
    expect(coordinator.revision).toBe("r1");
  });
});

describe("conflict presentation model", () => {
  it("resolves field labels and keeps both values with the reason", () => {
    const fields = [{ id: "status", label: "Status" }];
    const labels = new Map(fields.map((field) => [field.id, field.label] as const));
    const rows = conflictRows([{ write, serverValue: "Review", reason: "changed" }], labels);
    expect(rows).toEqual([{
      recordId: "r",
      fieldId: "status",
      fieldLabel: "Status",
      mine: "Done",
      server: "Review",
      reason: "changed",
    }]);
  });

  it("falls back to the field id without labels and keys each write uniquely", () => {
    const other: RecordFieldWrite = { datasetId: "d", recordId: "rōsie", fieldId: "status", after: "Done" };
    const rows = conflictRows([
      { write, reason: "changed" },
      { write: other, serverValue: "Review", reason: "stale" },
    ]);
    expect(rows.map((row) => row.fieldLabel)).toEqual(["status", "status"]);
    expect(rows[0]).toMatchObject({ mine: "Done", server: undefined });
    expect(conflictKey({ write, reason: "changed" })).not.toBe(conflictKey({ write: other, reason: "stale" }));
  });
});

describe("conflictWriteKeys", () => {
  const thrown = (conflicts: readonly { write: RecordFieldWrite; reason: string }[]) =>
    Object.assign(new Error("Revision conflict"), { status: 409, conflict: { status: "conflict", currentRevision: "r2", conflicts } });

  it("returns undefined for non-409 failures", () => {
    expect(conflictWriteKeys(new Error("boom"))).toBeUndefined();
    expect(conflictWriteKeys(Object.assign(new Error("nope"), { status: 500 }))).toBeUndefined();
  });

  it("returns \"all\" for a 409 without per-write detail", () => {
    expect(conflictWriteKeys(Object.assign(new Error("Revision conflict"), { status: 409 }))).toBe("all");
    expect(conflictWriteKeys(thrown([]))).toBe("all");
  });

  it("keys the listed conflicts by record and field", () => {
    const keys = conflictWriteKeys(thrown([{ write, reason: "changed" }]));
    expect(keys).toBeInstanceOf(Set);
    expect((keys as Set<string>).has(conflictKey({ write, reason: "changed" }))).toBe(true);
    expect((keys as Set<string>).has(conflictKey({ write: { ...write, recordId: "other" }, reason: "x" }))).toBe(false);
  });
});
