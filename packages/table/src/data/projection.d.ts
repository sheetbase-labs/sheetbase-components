import type { CellBinding } from "../engine/types";
import type { DatasetPage } from "./adapter";
export type DatasetColumnProjection = Readonly<{
    column: number;
    fieldId: string;
}>;
export type MaterializedCell = Readonly<{
    display: string;
    binding: CellBinding;
}>;
export type MaterializedPage = ReadonlyMap<string, MaterializedCell>;
/** Maps page-relative records to sheet coordinates without losing record identity. */
export declare function materializeDatasetPage(page: DatasetPage, columns: readonly DatasetColumnProjection[], headerRows?: number): MaterializedPage;
