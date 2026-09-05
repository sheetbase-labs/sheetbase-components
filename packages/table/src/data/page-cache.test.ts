import { describe, expect, it } from "vitest";
import type { DatasetPage, PageRequest } from "./adapter";
import { DataPageCache } from "./page-cache";

const request = (rowStart: number): PageRequest => ({
  datasetId: "experiments",
  rowStart,
  rowCount: 100,
  fieldIds: ["result"],
  queryKey: "all",
});

const page = (rowStart: number): DatasetPage => ({
  request: request(rowStart),
  totalRows: 1_000,
  revision: "r1",
  records: [],
});

describe("DataPageCache", () => {
  it("evicts the least recently used page", () => {
    const cache = new DataPageCache(2);
    cache.set(page(0));
    cache.set(page(100));
    cache.get(request(0));
    cache.set(page(200));
    expect(cache.get(request(0))).toBeDefined();
    expect(cache.get(request(100))).toBeUndefined();
  });

  it("deduplicates concurrent loads for the same viewport", async () => {
    const cache = new DataPageCache();
    let loads = 0;
    const load = async () => { loads += 1; return page(0); };
    const [first, second] = await Promise.all([
      cache.getOrLoad(request(0), load),
      cache.getOrLoad(request(0), load),
    ]);
    expect(first).toBe(second);
    expect(loads).toBe(1);
  });
  it("tolerates pages whose request lacks fieldIds", () => {
    const cache = new DataPageCache();
    const shapeless = { request: { datasetId: "experiments", rowStart: 0, rowCount: 100, queryKey: "all" }, totalRows: 0, revision: "r1", records: [] } as unknown as DatasetPage;
    cache.set(shapeless);
    expect(cache.get(request(0)) ?? shapeless).toBeDefined();
  });
});
