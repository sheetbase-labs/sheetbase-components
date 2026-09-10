import type { CellBinding, Scalar } from "../engine";
import type { CommitResult, DatasetPage, PageRequest, PagedDataAdapter, RecordFieldWrite } from "./adapter";
export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
/** JSON-over-HTTP implementation of the renderer's structured-data boundary. */
export declare class HttpPagedDataAdapter implements PagedDataAdapter {
    #private;
    readonly baseUrl: string;
    readonly fetcher: FetchLike;
    constructor(baseUrl: string, fetcher?: FetchLike);
    resolve(binding: CellBinding): Scalar;
    fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage>;
    commit(writes: readonly RecordFieldWrite[], baseRevision?: string): Promise<CommitResult>;
    createRecord(datasetId: string, values: Readonly<Record<string, string>>, baseRevision?: string): Promise<Readonly<{
        recordId: string;
        revision: string;
    }>>;
}
