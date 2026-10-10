import type { SheetbaseField } from "./fields";
import type { FilterClause, SortClause } from "./query";
import type { GroupNode } from "./tree";
import type { WorkspaceAggregateQuery, WorkspaceAggregateResponse, WorkspaceDataSource } from "./workspace";

/**
 * Studio data sources — one contract for every upstream a scientist explores:
 * rows the host already has, an uploaded file, an HTTP API or a Python/Ibis
 * backend. Every operation runs where the data lives; the UI only ever sees
 * pages, buckets, profiles, bins and samples.
 *
 * The wire shapes below are plain JSON so non-TypeScript executors (the
 * `sheetbase` Python package) implement the same contract. Filter trees keep
 * `buildPredicate` semantics everywhere — see `packages/shared/README.md`.
 */

/** A table (or saved query result) a source can explore. */
export type TableInfo = Readonly<{
  /** Stable id used as `datasetId` in every request. */
  id: string;
  label: string;
  /** Total rows, or null when the source can't count cheaply. */
  rowCount: number | null;
  fields: readonly SheetbaseField[];
  /** `query` tables are derived from SQL the user ran; they carry the SQL. */
  kind: "table" | "view" | "query";
  sql?: string;
  description?: string;
}>;

/** What a source can do. The studio hides or explains anything it can't. */
export type SourceCapabilities = Readonly<{
  /** Read-only SQL that registers its result as a new `query` table. */
  sql: boolean;
  /** Dialect shown in the SQL editor ("duckdb", "postgres", …). */
  sqlDialect?: string;
  /** Exact per-field profiles (counts, nulls, quantiles, top values, bins). */
  profile: boolean;
  /** Exact server-side histogram bins. */
  histogram: boolean;
  /** Random row samples for raw-row charts (scatter, box, violin, heatmap). */
  sample: boolean;
}>;

/** Counts and shape of one field, computed where the data lives. */
export type FieldProfile = Readonly<{
  field: string;
  /** Rows considered (after the profile's filter). */
  count: number;
  /** Null or blank values. */
  nulls: number;
  /** Distinct non-null values; `distinctApprox` marks an estimate. */
  distinct: number | null;
  distinctApprox?: boolean;
  /** Numeric/date summary. Dates are ISO strings. */
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  std?: number | null;
  quantiles?: Readonly<{ p05: number; p25: number; p50: number; p75: number; p95: number }> | null;
  /** Most frequent values (text, boolean, low-cardinality numbers). */
  top?: readonly Readonly<{ value: string; count: number }>[];
  /** Equal-width bins for numbers; dates use epoch-millisecond edges. */
  histogram?: Readonly<{ edges: readonly number[]; counts: readonly number[] }> | null;
}>;

export type ProfileQuery = Readonly<{
  fields: readonly string[];
  filter?: GroupNode;
  /** Bins for numeric/date histograms. Default 20. */
  bins?: number;
  /** Top values to return. Default 8. */
  top?: number;
}>;

export type ProfileResponse = Readonly<{
  totalRows: number;
  profiles: readonly FieldProfile[];
}>;

export type HistogramQuery = Readonly<{
  field: string;
  filter?: GroupNode;
  /** Bin count over the observed range (ignored when `binWidth` is set). */
  bins?: number;
  binWidth?: number;
  /** Optional series field: each series shares the same edges. */
  by?: string;
}>;

export type HistogramResponse = Readonly<{
  field: string;
  edges: readonly number[];
  series: readonly Readonly<{ key: string | null; counts: readonly number[] }>[];
  /** Rows matching the filter, including nulls. */
  totalRows: number;
  /** Rows with a null value for the field (not binned). */
  nulls: number;
}>;

export type SampleQuery = Readonly<{
  fields: readonly string[];
  n: number;
  filter?: GroupNode;
  /** Same seed + same data → same sample. */
  seed?: number;
}>;

export type SampleResponse = Readonly<{
  rows: readonly Record<string, unknown>[];
  /** Rows matching the filter. */
  totalRows: number;
  /** False when every matching row fit in the sample. */
  sampled: boolean;
}>;

export type PageQuery = Readonly<{
  rowStart: number;
  rowCount: number;
  fieldIds: readonly string[];
  sort?: readonly SortClause[];
  filters?: readonly FilterClause[];
  filterLogic?: "and" | "or";
  filterTree?: GroupNode;
}>;

export type PageResponse = Readonly<{
  records: readonly Readonly<{ recordId: string; values: Record<string, unknown> }>[];
  totalRows: number;
  revision?: string;
}>;

/**
 * One upstream: a set of tables plus the operations the studio needs. Every
 * call takes the table id; implementations must apply `filter`/`filterTree`
 * with `buildPredicate` semantics or reject the request — never ignore it.
 */
export interface StudioDataSource {
  readonly id: string;
  readonly label: string;
  /** "memory", "file", "http", "python", … — shown as a badge. */
  readonly kind: string;
  readonly capabilities: SourceCapabilities;
  catalog(signal?: AbortSignal): Promise<readonly TableInfo[]>;
  page(tableId: string, query: PageQuery, signal?: AbortSignal): Promise<PageResponse>;
  aggregate(tableId: string, query: WorkspaceAggregateQuery, signal?: AbortSignal): Promise<WorkspaceAggregateResponse>;
  profile?(tableId: string, query: ProfileQuery, signal?: AbortSignal): Promise<ProfileResponse>;
  histogram?(tableId: string, query: HistogramQuery, signal?: AbortSignal): Promise<HistogramResponse>;
  sample?(tableId: string, query: SampleQuery, signal?: AbortSignal): Promise<SampleResponse>;
  /**
   * Run read-only SQL (a single SELECT/WITH statement) and register the
   * result as a new `query` table. Sources reject anything else.
   */
  sql?(text: string, signal?: AbortSignal): Promise<TableInfo>;
  /**
   * Accept a file (CSV, TSV, Parquet, JSON, Excel…) and register one table
   * per sheet/file. Absent when the source can't take uploads.
   */
  upload?(file: File, signal?: AbortSignal): Promise<readonly TableInfo[]>;
  /** Release workers/connections. */
  dispose?(): void;
}

/** Bind one table of a studio source to the workbench's `WorkspaceDataSource`. */
export function workspaceSourceFor(source: StudioDataSource, tableId: string): WorkspaceDataSource {
  return {
    fetchPage: (request, signal) => source.page(tableId, {
      rowStart: request.rowStart,
      rowCount: request.rowCount,
      fieldIds: request.fieldIds,
      sort: request.sort,
      filters: request.filters,
      filterLogic: request.filterLogic,
      filterTree: request.filterTree,
    }, signal),
    aggregate: (query, signal) => source.aggregate(tableId, query, signal),
  };
}

/** Null-or-blank test shared by every profile implementation. */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}
