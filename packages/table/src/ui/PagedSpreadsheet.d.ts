import { DataPageCache } from "../data/page-cache";
import { type DatasetQuery } from "../data/query";
import type { PagedDataAdapter } from "../data/adapter";
import { type SpreadsheetHandle, type SpreadsheetProps } from "./Spreadsheet";
export type PagedSpreadsheetProps = Omit<SpreadsheetProps, "initialData" | "bindingResolver" | "onViewportChange" | "onFieldWrite" | "onRecordCreate" | "sortMode" | "fieldIds"> & Readonly<{
    adapter: PagedDataAdapter;
    datasetId: string;
    fieldIds: readonly string[];
    query?: DatasetQuery;
    pageSize?: number;
    prefetchPages?: number;
    cachePages?: number;
    onLoadError?(error: unknown): void;
    onTotalRowsChange?(totalRows: number): void;
    pageCache?: DataPageCache;
    showLoadStatus?: boolean;
    showLoadTimings?: boolean;
}>;
/** Connects a single Spreadsheet renderer to a paged, revision-aware data adapter. */
export declare const PagedSpreadsheet: import("react").NamedExoticComponent<Omit<SpreadsheetProps, "fieldIds" | "initialData" | "onViewportChange" | "bindingResolver" | "sortMode" | "onFieldWrite" | "onRecordCreate"> & Readonly<{
    adapter: PagedDataAdapter;
    datasetId: string;
    fieldIds: readonly string[];
    query?: DatasetQuery;
    pageSize?: number;
    prefetchPages?: number;
    cachePages?: number;
    onLoadError?(error: unknown): void;
    onTotalRowsChange?(totalRows: number): void;
    pageCache?: DataPageCache;
    showLoadStatus?: boolean;
    showLoadTimings?: boolean;
}> & import("react").RefAttributes<SpreadsheetHandle>>;
