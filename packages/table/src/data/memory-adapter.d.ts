import type { Scalar } from "../engine";
import type { PagedDataAdapter } from "./adapter";
export interface MemoryDatasetRow {
    recordId: string;
    values: Record<string, Scalar>;
}
/**
 * In-memory `PagedDataAdapter` for examples and tests: applies the request's
 * filters/sort, then paginates. Edits via `commit` mutate the in-memory rows.
 */
export declare function createMemoryPagedAdapter(rows: readonly MemoryDatasetRow[], initialRevision?: string): PagedDataAdapter;
