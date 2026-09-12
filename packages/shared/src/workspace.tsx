import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { SheetbaseField } from "./fields";
import type { DatasetQuery, FilterClause, SortClause } from "./query";
import type { GroupNode } from "./tree";
import { applySearch } from "./tree";
import { applyView, pruneViewToFields, searchSpecFromView, type AnalysisView } from "./analysis";
import { loadInitialState, type PersistenceAdapter } from "./persistence";

/**
 * A paged/server data source for datasets too large to materialise. This is a
 * structural twin of the table's `PagedDataAdapter.fetchPage` — shared can't
 * import table types, so the request/response stay minimal and any real
 * `PagedDataAdapter` satisfies it.
 */
export interface WorkspaceDataSource {
  fetchPage(request: {
    datasetId: string;
    rowStart: number;
    rowCount: number;
    fieldIds: readonly string[];
    sort?: readonly SortClause[];
    filters?: readonly FilterClause[];
    filterLogic?: "and" | "or";
    filterTree?: GroupNode;
  }, signal?: AbortSignal): Promise<{
    records: readonly { recordId: string; values: Record<string, unknown> }[];
    totalRows: number;
    revision?: string;
  }>;
  /**
   * Optional server-side group+aggregate — a structural twin of the
   * explorer's `RemoteDatasetSource.aggregate`. Any object satisfying the
   * explorer contract satisfies this one; when absent, panes that need
   * aggregation show their remote note instead.
   */
  aggregate?(query: WorkspaceAggregateQuery, signal?: AbortSignal): Promise<WorkspaceAggregateResponse>;
}

/** Structural twin of the explorer's `AggregateQuery` (shared can't import it). */
export interface WorkspaceAggregateQuery {
  /** Filter tree; authoritative over any flat list. */
  filter?: GroupNode;
  groupBy: string;
  /**
   * Additional statistical dimensions (spec.group/color/facet, deduped,
   * excluding groupBy). Buckets key on (groupBy × seriesBy) and report
   * their series values in `series`; servers may ignore it and degrade.
   */
  seriesBy?: string[];
  summary: "mean" | "median" | "sum" | "count" | "min" | "max";
  valueField?: string;
  limit?: number;
}

/** Structural twin of the explorer's `AggregateResponse`. */
export interface WorkspaceAggregateResponse {
  buckets: { key: string; series?: Record<string, string>; count: number; value: number | null }[];
  totalRows: number;
  revision?: string;
}

/**
 * Shared, host-owned state that several components read from and write to,
 * so they can interact without the host wiring every pair directly.
 *
 * The host owns the state (React state / store) and passes it in; components
 * read slices via the hooks and report edits through their existing callbacks.
 */
export interface WorkspaceState {
  /** Active dataset fields (e.g. the selected schema model's columns). */
  fields: readonly SheetbaseField[];
  /** Materialised rows — omit when `source` pages from a server. */
  rows?: readonly Record<string, unknown>[];
  /** Paged source for server-backed datasets; takes precedence over `rows`. */
  source?: WorkspaceDataSource;
  /** Compiled query — filters/sort — shared by search, table and rules. */
  query: DatasetQuery;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceState; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Full workspace, or null when used outside a provider. */
export function useWorkspace(): WorkspaceState | null {
  return useContext(WorkspaceContext);
}

export function useWorkspaceQuery(fallback: DatasetQuery = {}): DatasetQuery {
  return useContext(WorkspaceContext)?.query ?? fallback;
}

export function useWorkspaceFields(fallback: readonly SheetbaseField[] = []): readonly SheetbaseField[] {
  return useContext(WorkspaceContext)?.fields ?? fallback;
}

export function useWorkspaceRows(fallback: readonly Record<string, unknown>[] = []): readonly Record<string, unknown>[] {
  return useContext(WorkspaceContext)?.rows ?? fallback;
}

/** The paged/server data source, or null when the workspace is materialised. */
export function useWorkspaceSource(): WorkspaceDataSource | null {
  return useContext(WorkspaceContext)?.source ?? null;
}

export interface UseWorkbenchOptions {
  /** Active dataset fields (typically from the schema editor). */
  fields: readonly SheetbaseField[];
  /**
   * Workspace rows — the snapshot search, explorer and rules evaluate.
   * Mutually exclusive with `source`: provide exactly one.
   */
  rows?: readonly Record<string, unknown>[];
  /**
   * Paged/server data source for datasets too large to materialise. When
   * set, `viewRows`/`filteredRows` are null (they can't be derived
   * client-side) and consumers show their remote affordances instead.
   */
  source?: WorkspaceDataSource;
  /** Starting view when nothing is persisted. */
  initialView: AnalysisView;
  /** Load a stored view once at mount. Saving stays with the search pane. */
  persistKey?: string;
  adapter?: PersistenceAdapter<AnalysisView>;
}

/**
 * The props the workbench composition hands to each component — search edits
 * the one view, explorer charts through it, the compiled query feeds the
 * table, and rules evaluate the view-filtered rows.
 */
export interface WorkbenchGlue {
  /** The one AnalysisView shared by search and explorer. */
  view: AnalysisView;
  /** Replace the view — the explorer's `onViewChange`. */
  setView: Dispatch<SetStateAction<AnalysisView>>;
  /** Merge a partial edit — the search pane's `onChange`. */
  patchView(patch: Partial<AnalysisView>): void;
  /** Compiled query the table follows — search's `onDatasetQueryChange`. */
  query: DatasetQuery;
  setQuery(next: DatasetQuery): void;
  /** `rows` after the view's filter + sort + limit — feed explorer and rules.
   *  Null when the workspace is server-backed (`source` mode). */
  viewRows: readonly Record<string, unknown>[] | null;
  /** `rows` after the view's filter + sort only — the "filtered N / M" counter.
   *  Null when the workspace is server-backed. */
  filteredRows: readonly Record<string, unknown>[] | null;
  /** True when the workspace pages from `source` instead of materialised `rows`. */
  remote: boolean;
  /** Ready-made `WorkspaceProvider` value. */
  workspace: WorkspaceState;
}

const EMPTY_ROWS: readonly Record<string, unknown>[] = [];

/**
 * The workbench composition as code: one `AnalysisView` shared between the
 * search pane and the explorer, the compiled `DatasetQuery` forwarded to the
 * table, and the derived row slices every consumer reads.
 */
export function useWorkbench(options: UseWorkbenchOptions): WorkbenchGlue {
  const { fields, rows, source, initialView, persistKey, adapter } = options;
  if ((rows === undefined) === (source === undefined)) {
    throw new TypeError("useWorkbench requires exactly one of `rows` or `source`");
  }
  const remote = source !== undefined;
  const [view, setView] = useState<AnalysisView>(() => {
    const merged = { ...initialView, ...loadInitialState(persistKey, adapter, initialView) };
    // A persisted view is dataset-relative: a condition or binding on a field
    // this dataset doesn't have must not compile into its queries (remote
    // executors would reject or silently mis-filter). Unknown fields can't be
    // validated while `fields` is empty, so the view loads untouched then.
    return fields.length > 0 ? pruneViewToFields(merged, fields) : merged;
  });
  const [query, setQuery] = useState<DatasetQuery>({});
  const patchView = useCallback((patch: Partial<AnalysisView>) => {
    setView((current) => ({ ...current, ...patch }));
  }, []);
  const localRows = rows ?? EMPTY_ROWS;
  const viewRows = useMemo(() => (remote ? null : applyView(localRows, view)), [remote, localRows, view]);
  const filteredRows = useMemo(
    () => (remote ? null : applySearch(localRows, searchSpecFromView({ ...view, limit: undefined }))),
    [remote, localRows, view],
  );
  const workspace = useMemo<WorkspaceState>(
    () => (remote ? { fields, query, source } : { fields, rows, query }),
    [remote, fields, rows, source, query],
  );
  return { view, setView, patchView, query, setQuery, viewRows, filteredRows, remote, workspace };
}
