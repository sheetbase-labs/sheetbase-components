import { describe, expect, it } from "vitest";
import { AsyncFunctionRegistry, QUERY_RECORDS_CAPABILITY } from "./async-functions";
import type { FunctionContext } from "./functions";

const ctx: FunctionContext = { resolve: () => null };

describe("AsyncFunctionRegistry", () => {
  it("blocks the built-in QUERYRECORDS stub by default", async () => {
    const registry = new AsyncFunctionRegistry();
    expect(registry.has("QUERYRECORDS")).toBe(true);
    expect(registry.capabilityFor("QUERYRECORDS")).toBe(QUERY_RECORDS_CAPABILITY);
    expect(registry.isCapabilityGranted(QUERY_RECORDS_CAPABILITY)).toBe(false);
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
  });

  it("executes QUERYRECORDS once the capability is granted", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.grant(QUERY_RECORDS_CAPABILITY);
    expect(registry.isCapabilityGranted(QUERY_RECORDS_CAPABILITY)).toBe(true);
    await expect(registry.call("queryrecords", [], ctx)).resolves.toBeNull();
  });

  it("re-blocks after revoke", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.grant(QUERY_RECORDS_CAPABILITY);
    registry.revoke(QUERY_RECORDS_CAPABILITY);
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
  });

  it("rejects unknown names with #NAME?", async () => {
    const registry = new AsyncFunctionRegistry();
    expect(registry.has("NOPE")).toBe(false);
    expect(registry.get("NOPE")).toBeUndefined();
    await expect(registry.call("NOPE", [], ctx)).rejects.toThrow("#NAME?");
  });

  it("runs capability-less host functions without a grant", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("DOUBLE-IT", async (args) =>
      typeof args[0] === "number" ? args[0] * 2 : "#VALUE!",
    );
    expect(registry.capabilityFor("DOUBLE-IT")).toBeUndefined();
    await expect(registry.call("double-it", [21], ctx)).resolves.toBe(42);
  });

  it("lets hosts replace the stub with real transport under the same gate", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", async () => "host-rows", {
      capability: QUERY_RECORDS_CAPABILITY,
    });
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
    registry.grant(QUERY_RECORDS_CAPABILITY);
    await expect(registry.call("QUERYRECORDS", [], ctx)).resolves.toBe("host-rows");
  });
});

import { createAsyncFormulaExecutor } from "./async-functions";
import { createQueryRecordsTransport } from "../data/query-records";
import { createMemoryPagedAdapter } from "../data/memory-adapter";
import { DataPageCache } from "../data/page-cache";
import { Worksheet } from "./workbook";
import type { PagedDataAdapter, PageRequest } from "../data/adapter";

const sample = createMemoryPagedAdapter([
  { recordId: "r1", values: { status: "open", n: 1 } },
  { recordId: "r2", values: { status: "done", n: 2 } },
  { recordId: "r3", values: { status: "open", n: 3 } },
]);

function counting(adapter: PagedDataAdapter): { adapter: PagedDataAdapter; fetches: () => number } {
  let count = 0;
  return {
    adapter: { ...adapter, fetchPage: (request: PageRequest, signal?: AbortSignal) => { count += 1; return adapter.fetchPage(request, signal); } },
    fetches: () => count,
  };
}

describe("QUERYRECORDS transport", () => {
  it("resolves a field's values as a single-column spill through the adapter", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(sample), { capability: QUERY_RECORDS_CAPABILITY });
    registry.grant(QUERY_RECORDS_CAPABILITY);
    const sheet = new Worksheet();
    sheet.setInput("A1", '=QUERYRECORDS("sample","status")');
    const executor = createAsyncFormulaExecutor(registry);
    await sheet.recalculateAsync(executor.execute);
    expect(sheet.value("A1")).toBe("open");
    expect(sheet.value("A2")).toBe("done");
    expect(sheet.value("A3")).toBe("open");
    expect(executor.asyncAddresses()).toEqual(["A1"]);
  });

  it("composes with sync functions inside the async program", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(sample), { capability: QUERY_RECORDS_CAPABILITY });
    registry.grant(QUERY_RECORDS_CAPABILITY);
    const sheet = new Worksheet();
    sheet.setInput("A1", '=SUM(QUERYRECORDS("sample","n"))');
    await sheet.recalculateAsync(createAsyncFormulaExecutor(registry).execute);
    expect(sheet.value("A1")).toBe(6);
  });

  it("still blocks when the capability is ungranted, with the real transport registered", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(sample), { capability: QUERY_RECORDS_CAPABILITY });
    const sheet = new Worksheet();
    sheet.setInput("A1", '=QUERYRECORDS("sample","status")');
    await expect(sheet.recalculateAsync(createAsyncFormulaExecutor(registry).execute)).rejects.toThrow("#BLOCKED!");
  });

  it("shares one fetch across formulas over the same query", async () => {
    const wrapped = counting(sample);
    const cache = new DataPageCache(8);
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(wrapped.adapter, cache), { capability: QUERY_RECORDS_CAPABILITY });
    registry.grant(QUERY_RECORDS_CAPABILITY);
    const sheet = new Worksheet();
    sheet.setInput("A1", '=QUERYRECORDS("sample","status")');
    sheet.setInput("B1", '=QUERYRECORDS("sample","status")');
    await sheet.recalculateAsync(createAsyncFormulaExecutor(registry).execute);
    expect(wrapped.fetches()).toBe(1);
    expect(sheet.value("A1")).toBe("open");
    expect(sheet.value("B1")).toBe("open");
  });

  it("raises #N/A for an empty result and #VALUE! for bad args", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(sample), { capability: QUERY_RECORDS_CAPABILITY });
    registry.grant(QUERY_RECORDS_CAPABILITY);
    const emptySheet = new Worksheet();
    emptySheet.setInput("A1", '=QUERYRECORDS("sample","status")');
    // A dataset with zero records is the empty-result case (the memory adapter
    // doesn't partition by datasetId).
    registry.register("QUERYRECORDS", createQueryRecordsTransport(createMemoryPagedAdapter([])), { capability: QUERY_RECORDS_CAPABILITY });
    await expect(emptySheet.recalculateAsync(createAsyncFormulaExecutor(registry).execute)).rejects.toThrow("#N/A");
    const badArgs = new Worksheet();
    badArgs.setInput("B1", "=QUERYRECORDS()");
    await expect(badArgs.recalculateAsync(createAsyncFormulaExecutor(registry).execute)).rejects.toThrow("#VALUE!");
  });

  it("surfaces fresh values after the host invalidates on a revision bump", async () => {
    const data = createMemoryPagedAdapter([{ recordId: "r1", values: { status: "open" } }]);
    const cache = new DataPageCache(8);
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", createQueryRecordsTransport(data, cache), { capability: QUERY_RECORDS_CAPABILITY });
    registry.grant(QUERY_RECORDS_CAPABILITY);
    const sheet = new Worksheet();
    sheet.setInput("A1", '=QUERYRECORDS("sample","status")');
    const executor = createAsyncFormulaExecutor(registry);
    await sheet.recalculateAsync(executor.execute);
    expect(sheet.value("A1")).toBe("open");
    await data.commit([{ datasetId: "sample", recordId: "r1", fieldId: "status", after: "done" }]);
    cache.invalidateDataset("sample");
    for (const address of executor.asyncAddresses()) sheet.invalidate(address);
    await sheet.recalculateAsync(executor.execute);
    expect(sheet.value("A1")).toBe("done");
  });
});
