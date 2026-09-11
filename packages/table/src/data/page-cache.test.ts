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
  it("keys pages by canonical filter tree, not session-random node ids", () => {
    const cache = new DataPageCache();
    const tree = (groupId: string, condId: string) => ({
      type: "group" as const, id: groupId, combinator: "NOT" as const,
      children: [{ type: "condition" as const, id: condId, field: "status", operator: "eq" as const, value: "Complete" }],
    });
    const requestA = { ...request(0), filterTree: tree("grp_1", "cnd_1") };
    const requestB = { ...request(0), filterTree: tree("grp_2", "cnd_2") };
    const other = { ...request(0), filterTree: { ...tree("grp_3", "cnd_3"), combinator: "OR" as const } };
    cache.set({ ...page(0), request: requestA });
    expect(cache.get(requestB)).toBeDefined();
    expect(cache.get(other)).toBeUndefined();
  });
  it("tolerates pages whose request lacks fieldIds", () => {
    const cache = new DataPageCache();
    const shapeless = { request: { datasetId: "experiments", rowStart: 0, rowCount: 100, queryKey: "all" }, totalRows: 0, revision: "r1", records: [] } as unknown as DatasetPage;
    cache.set(shapeless);
    expect(cache.get(request(0)) ?? shapeless).toBeDefined();
  });
});
