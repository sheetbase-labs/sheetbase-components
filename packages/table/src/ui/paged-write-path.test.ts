import { describe, expect, it } from "vitest";
import { DataPageCache } from "../data/page-cache";
import { RevisionedCommitCoordinator } from "../data/conflicts";
import { createMemoryPagedAdapter } from "../data/memory-adapter";
import type { PageRequest } from "../data/adapter";

// PagedSpreadsheet has no component test harness; this file covers the seam it
// relies on: a committed write must invalidate the page cache so the next
// fetch reflects it, and a stale cached page must not rewind the coordinator's
// commit baseline.

const request: PageRequest = { datasetId: "d", rowStart: 0, rowCount: 10, fieldIds: ["status"], queryKey: "k" };

function fixture() {
  const adapter = createMemoryPagedAdapter([
    { recordId: "r1", values: { status: "Open" } },
    { recordId: "r2", values: { status: "Open" } },
  ]);
  const cache = new DataPageCache();
  const coordinator = new RevisionedCommitCoordinator(adapter);
  return { adapter, cache, coordinator };
}

describe("paged write path", () => {
  it("serves the pre-commit page until the dataset is invalidated", async () => {
    const { adapter, cache, coordinator } = fixture();
    let fetches = 0;
    const fetch = () => { fetches++; return adapter.fetchPage(request); };
    const page = await cache.getOrLoad(request, fetch);
    coordinator.acceptRevision(page.revision);

    const result = await coordinator.commit([{ datasetId: "d", recordId: "r1", fieldId: "status", after: "Done" }]);
    expect(result.status).toBe("committed");

    // Without invalidation the cache still serves the page fetched before the
    // commit — no new fetch happens, so post-commit data is never seen.
    expect(cache.get(request)).toBe(page);
    expect(await cache.getOrLoad(request, fetch)).toBe(page);
    expect(fetches).toBe(1);

    cache.invalidateDataset("d");
    expect(cache.size).toBe(0);
    const fresh = await cache.getOrLoad(request, fetch);
    expect(fetches).toBe(2);
    expect(fresh.records[0]!.values.status).toBe("Done");
    expect(fresh.revision).toBe(coordinator.revision);
  });

  it("a stale cached page cannot rewind the commit baseline", async () => {
    const { adapter, cache, coordinator } = fixture();
    const page = await cache.getOrLoad(request, () => adapter.fetchPage(request));
    coordinator.acceptRevision(page.revision);
    await coordinator.commit([{ datasetId: "d", recordId: "r1", fieldId: "status", after: "Done" }]);
    const afterCommit = coordinator.revision;
    // Simulates loadViewport re-feeding the stale cached page's revision.
    coordinator.acceptRevision(page.revision);
    expect(coordinator.revision).toBe(afterCommit);
  });
});
