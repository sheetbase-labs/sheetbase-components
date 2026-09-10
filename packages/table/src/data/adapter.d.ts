import type { CellBinding, Scalar } from "../engine";
import type { GridMutation } from "../grid/mutations";
import type { FilterClause, SortClause } from "./query";
export type RecordFieldBinding = Extract<CellBinding, {
    kind: "record-field";
}>;
export type RecordFieldWrite = Readonly<{
    datasetId: string;
    recordId: string;
    fieldId: string;
    before?: string;
    after?: string;
}>;
export type CommitResult = Readonly<{
    revision: string;
    accepted: readonly RecordFieldWrite[];
    rejected: readonly {
        write: RecordFieldWrite;
        reason: string;
    }[];
}>;
/** Boundary implemented by Postgres/API integrations, never by the renderer. */
export interface DataAdapter {
    resolve(binding: CellBinding): Scalar;
    commit(writes: readonly RecordFieldWrite[], baseRevision?: string): Promise<CommitResult>;
    createRecord?(datasetId: string, values: Readonly<Record<string, string>>, baseRevision?: string): Promise<Readonly<{
        recordId: string;
        revision: string;
    }>>;
}
export type PageRequest = Readonly<{
    datasetId: string;
    rowStart: number;
    rowCount: number;
    fieldIds: readonly string[];
    queryKey: string;
    revision?: string;
    sort?: readonly SortClause[];
    filters?: readonly FilterClause[];
    filterLogic?: "and" | "or";
}>;
export type DatasetPage = Readonly<{
    request: PageRequest;
    totalRows: number;
    revision: string;
    records: readonly Readonly<{
        recordId: string;
        values: Readonly<Record<string, Scalar>>;
    }>[];
}>;
export interface PagedDataAdapter extends DataAdapter {
    fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage>;
}
export declare function recordWritesForMutation(mutation: GridMutation, bindings: ReadonlyMap<string, CellBinding>): readonly RecordFieldWrite[];
