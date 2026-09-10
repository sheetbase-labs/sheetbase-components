import type { DatasetPage, PageRequest, PagedDataAdapter } from "./adapter";
import { DataPageCache } from "./page-cache";
import type { DatasetQuery } from "./query";
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
export declare function isAbortError(error: unknown): boolean;
/** Converts arbitrary virtual windows into stable, cacheable backend pages. */
export declare class ViewportPageLoader {
    #private;
    readonly adapter: PagedDataAdapter;
    readonly cache: DataPageCache;
    readonly options: ViewportLoaderOptions;
    readonly pageSize: number;
    readonly prefetchPages: number;
    constructor(adapter: PagedDataAdapter, cache: DataPageCache, options: ViewportLoaderOptions);
    requestsFor(viewport: ViewportRequest, prefetchPages?: number): readonly PageRequest[];
    load(viewport: ViewportRequest, prefetchPages?: number): Promise<readonly DatasetPage[]>;
    dispose(): void;
}
