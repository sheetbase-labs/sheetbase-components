import { describe, expect, it, vi } from "vitest";
import { HttpPagedDataAdapter } from "./http-adapter";
import { RevisionConflictError } from "./conflicts";

describe("HttpPagedDataAdapter", () => {
  it("hydrates synchronous record bindings from fetched pages", async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({
      request: { datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["result"], queryKey: "all" },
      totalRows: 1,
      revision: "r1",
      records: [{ recordId: "one", values: { result: 12.5 } }],
    }) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await adapter.fetchPage({ datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["result"], queryKey: "all" });
    expect(adapter.resolve({ kind: "record-field", datasetId: "d", recordId: "one", fieldId: "result" })).toBe(12.5);
    expect(fetcher.mock.calls[0][0]).toContain("fieldIds=result");
  });

  it("updates accepted values after a commit", async () => {
    const write = { datasetId: "d", recordId: "one", fieldId: "result", after: "19.1" };
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ revision: "r2", accepted: [write], rejected: [] }) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await adapter.commit([write], "r1");
    expect(adapter.resolve({ kind: "record-field", datasetId: "d", recordId: "one", fieldId: "result" })).toBe("19.1");
  });

  it("serialises server-side queries and exposes revision conflicts", async () => {
    const conflict = { currentRevision: "r2", conflicts: [] };
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => init?.method === "POST"
      ? { ok: false, status: 409, json: async () => conflict }
      : { ok: true, status: 200, json: async () => ({ request: { datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["status"], queryKey: "filtered" }, totalRows: 0, revision: "r2", records: [] }) });
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await adapter.fetchPage({
      datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["status"], queryKey: "filtered",
      sort: [{ fieldId: "date", direction: "desc" }], filters: [{ fieldId: "status", operator: "eq", value: "Complete" }],
    });
    expect(fetcher.mock.calls[0][0]).toContain("filters=");
    await expect(adapter.commit([], "r1")).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("serialises filterTree onto the page request URL", async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({
      request: { datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["status"], queryKey: "tree" },
      totalRows: 0, revision: "r1", records: [],
    }) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    const filterTree = {
      type: "group" as const, id: "g1", combinator: "NOT" as const,
      children: [{ type: "condition" as const, id: "c1", field: "status", operator: "eq" as const, value: "Complete" }],
    };
    await adapter.fetchPage({
      datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["status"], queryKey: "tree", filterTree,
    });
    const url = new URL(fetcher.mock.calls[0][0], "http://test");
    expect(JSON.parse(url.searchParams.get("filterTree") ?? "null")).toEqual(filterTree);
  });

  it("creates records with values and an optimistic base revision", async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({ recordId: "created-1", revision: "r3" }),
    }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await expect(adapter.createRecord("d", { status: "Complete" }, "r2")).resolves.toEqual({ recordId: "created-1", revision: "r3" });
    expect(fetcher).toHaveBeenCalledWith("/api/sheets/records", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ datasetId: "d", values: { status: "Complete" }, baseRevision: "r2" }),
    }));
  });
  it("rejects malformed page responses before caching", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await expect(adapter.fetchPage({ datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["result"], queryKey: "all" })).rejects.toThrow("Malformed page response");
  });

  it("surfaces record-creation revision conflicts", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ currentRevision: "r4", conflicts: [] }) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    await expect(adapter.createRecord("d", {}, "r3")).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("treats a malformed 409 body as a failure, not a crash", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ unexpected: true }) }));
    const adapter = new HttpPagedDataAdapter("/api/sheets", fetcher);
    const failure = await adapter.commit([], "r1").catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TypeError);
    expect(failure).not.toBeInstanceOf(RevisionConflictError);
    expect((failure as Error).message).toBe("Commit failed (409)");
  });
});
