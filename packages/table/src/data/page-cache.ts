import type { DatasetPage, PageRequest } from "./adapter";
import { canonicalFilterTree } from "./query";

function pageKey(request: PageRequest): string {
  return [
    request.datasetId,
    request.queryKey,
    request.revision ?? "latest",
    request.rowStart,
    request.rowCount,
    (request.fieldIds ?? []).join(","),
    JSON.stringify(request.sort ?? []),
    JSON.stringify(request.filters ?? []),
    // Canonicalised: raw ids are session-random and would never dedupe.
    JSON.stringify(request.filterTree ? canonicalFilterTree(request.filterTree) : null),
  ].join("|");
}

/** Small LRU with in-flight request de-duplication for viewport-driven dataset pages. */
export class DataPageCache {
  readonly #pages = new Map<string, DatasetPage>();
  readonly #pending = new Map<string, Promise<DatasetPage>>();

  constructor(readonly maxPages = 24) {
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new RangeError("maxPages must be positive");
  }

  get size(): number { return this.#pages.size; }

  get(request: PageRequest): DatasetPage | undefined {
    const key = pageKey(request);
    const page = this.#pages.get(key);
    if (!page) return undefined;
    this.#pages.delete(key);
    this.#pages.set(key, page);
    return page;
  }

  set(page: DatasetPage): void {
    const key = pageKey(page.request);
    this.#pages.delete(key);
    this.#pages.set(key, page);
    while (this.#pages.size > this.maxPages) {
      const oldest = this.#pages.keys().next().value;
      if (oldest === undefined) break;
      this.#pages.delete(oldest);
    }
  }

  async getOrLoad(request: PageRequest, load: () => Promise<DatasetPage>): Promise<DatasetPage> {
    const cached = this.get(request);
    if (cached) return cached;
    const key = pageKey(request);
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const requestPromise = load().then((page) => {
      this.set(page);
      return page;
    }).finally(() => this.#pending.delete(key));
    this.#pending.set(key, requestPromise);
    return requestPromise;
  }

  invalidateDataset(datasetId: string): void {
    for (const [key, page] of this.#pages) {
      if (page.request.datasetId === datasetId) this.#pages.delete(key);
    }
  }

  clear(): void {
    this.#pages.clear();
    this.#pending.clear();
  }

  /** Forget in-flight entries after their owning request controllers are cancelled. */
  clearPending(): void {
    this.#pending.clear();
  }
}
