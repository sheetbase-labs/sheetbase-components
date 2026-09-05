import { describe, expect, it, vi } from "vitest";
import type { PagedDataAdapter } from "./adapter";
import { DataPageCache } from "./page-cache";
import { ViewportPageLoader, isAbortError } from "./viewport-loader";

describe("ViewportPageLoader", () => {
  it("aligns windows to pages, prefetches and reuses cached pages", async () => {
    const fetchPage = vi.fn(async (request) => ({ request, totalRows: 10_000, revision: "r1", records: [] }));
    const adapter = { fetchPage, resolve: () => null, commit: async () => ({ revision: "r1", accepted: [], rejected: [] }) } as PagedDataAdapter;
    const loader = new ViewportPageLoader(adapter, new DataPageCache(), {
      datasetId: "experiments", queryKey: "all", pageSize: 100, prefetchPages: 1,
    });
    const viewport = { rowStart: 130, rowEnd: 160, fieldIds: ["status", "result", "status"] };
    expect(loader.requestsFor(viewport).map((request) => request.rowStart)).toEqual([0, 100, 200]);
    expect(loader.requestsFor(viewport)[0].fieldIds).toEqual(["result", "status"]);
    await Promise.all([loader.load(viewport), loader.load(viewport)]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("can suppress neighbouring prefetch for first paint", () => {
    const adapter = { fetchPage: vi.fn(), resolve: () => null, commit: vi.fn() } as unknown as PagedDataAdapter;
    const loader = new ViewportPageLoader(adapter, new DataPageCache(), { datasetId: "experiments", pageSize: 100, prefetchPages: 2 });
    const viewport = { rowStart: 130, rowEnd: 160, fieldIds: ["result"] };
    expect(loader.requestsFor(viewport).map((request) => request.rowStart)).toEqual([0, 100, 200, 300]);
    expect(loader.requestsFor(viewport, 0).map((request) => request.rowStart)).toEqual([100]);
  });

  it("identifies expected cancellation when a loader is disposed", async () => {
    const fetchPage = (_request: Parameters<PagedDataAdapter["fetchPage"]>[0], signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const adapter = { fetchPage, resolve: () => null, commit: async () => ({ revision: "r1", accepted: [], rejected: [] }) } as PagedDataAdapter;
    const loader = new ViewportPageLoader(adapter, new DataPageCache(), { datasetId: "experiments", pageSize: 100, prefetchPages: 0 });
    const pending = loader.load({ rowStart: 0, rowEnd: 20, fieldIds: ["result"] });
    loader.dispose();
    await expect(pending).rejects.toSatisfy(isAbortError);
  });

  it("starts a fresh request immediately after strict-mode disposal", async () => {
    let call = 0;
    const fetchPage = (request: Parameters<PagedDataAdapter["fetchPage"]>[0], signal?: AbortSignal) => {
      call++;
      if (call > 1) return Promise.resolve({ request, totalRows: 1_000_000, revision: "r1", records: [] });
      return new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    };
    const adapter = { fetchPage, resolve: () => null, commit: async () => ({ revision: "r1", accepted: [], rejected: [] }) } as PagedDataAdapter;
    const cache = new DataPageCache();
    const firstLoader = new ViewportPageLoader(adapter, cache, { datasetId: "experiments", pageSize: 100, prefetchPages: 0 });
    const viewport = { rowStart: 0, rowEnd: 20, fieldIds: ["result"] };
    const cancelled = firstLoader.load(viewport);
    firstLoader.dispose();
    const remountedLoader = new ViewportPageLoader(adapter, cache, { datasetId: "experiments", pageSize: 100, prefetchPages: 0 });
    await expect(remountedLoader.load(viewport)).resolves.toHaveLength(1);
    await expect(cancelled).rejects.toSatisfy(isAbortError);
    expect(call).toBe(2);
  });
});
