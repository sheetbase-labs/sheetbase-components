import type { DatasetPage, PageRequest, PagedDataAdapter } from "./adapter";
import type { DataPageCache } from "./page-cache";
import type { DatasetQuery } from "./query";
import { queryKey } from "./query";

export type ViewportRequest = Readonly<{
  rowStart: number;
  rowEnd: number;
  fieldIds: readonly string[];
}>;

export type ViewportLoaderOptions = Readonly<{
  datasetId: string;
  queryKey?: string;
  query?: DatasetQuery;
  revision?: string;
  pageSize?: number;
  prefetchPages?: number;
}>;

/** Expected cancellation from a superseded viewport or disposed React effect. */
export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Converts arbitrary virtual windows into stable, cacheable backend pages. */
export class ViewportPageLoader {
  readonly #controllers = new Set<AbortController>();
  readonly pageSize: number;
  readonly prefetchPages: number;

  constructor(
    readonly adapter: PagedDataAdapter,
    readonly cache: DataPageCache,
    readonly options: ViewportLoaderOptions,
  ) {
    this.pageSize = options.pageSize ?? 200;
    this.prefetchPages = options.prefetchPages ?? 1;
    if (this.pageSize < 1 || !Number.isInteger(this.pageSize)) throw new RangeError("pageSize must be positive");
    if (this.prefetchPages < 0 || !Number.isInteger(this.prefetchPages)) throw new RangeError("prefetchPages must be non-negative");
  }

  requestsFor(viewport: ViewportRequest, prefetchPages = this.prefetchPages): readonly PageRequest[] {
    const first = Math.max(0, Math.floor(viewport.rowStart / this.pageSize) - prefetchPages);
    const last = Math.floor(Math.max(viewport.rowStart, viewport.rowEnd) / this.pageSize) + prefetchPages;
    const fieldIds = [...new Set(viewport.fieldIds)].sort();
    return Array.from({ length: last - first + 1 }, (_, offset) => ({
      datasetId: this.options.datasetId,
      rowStart: (first + offset) * this.pageSize,
      rowCount: this.pageSize,
      fieldIds,
      queryKey: this.options.queryKey ?? queryKey(this.options.query ?? {}),
      revision: this.options.revision,
      sort: this.options.query?.sort,
      filters: this.options.query?.filters,
      filterLogic: this.options.query?.filterLogic,
      filterTree: this.options.query?.filterTree,
    }));
  }

  async load(viewport: ViewportRequest, prefetchPages = this.prefetchPages): Promise<readonly DatasetPage[]> {
    return Promise.all(this.requestsFor(viewport, prefetchPages).map((request) => this.cache.getOrLoad(request, async () => {
      const controller = new AbortController();
      this.#controllers.add(controller);
      try {
        return await this.adapter.fetchPage(request, controller.signal);
      } finally {
        this.#controllers.delete(controller);
      }
    })));
  }

  dispose(): void {
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.cache.clearPending();
  }
}
