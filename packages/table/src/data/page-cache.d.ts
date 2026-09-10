import type { DatasetPage, PageRequest } from "./adapter";
/** Small LRU with in-flight request de-duplication for viewport-driven dataset pages. */
export declare class DataPageCache {
    #private;
    readonly maxPages: number;
    constructor(maxPages?: number);
    get size(): number;
    get(request: PageRequest): DatasetPage | undefined;
    set(page: DatasetPage): void;
    getOrLoad(request: PageRequest, load: () => Promise<DatasetPage>): Promise<DatasetPage>;
    invalidateDataset(datasetId: string): void;
    clear(): void;
    /** Forget in-flight entries after their owning request controllers are cancelled. */
    clearPending(): void;
}
