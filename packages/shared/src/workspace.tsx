import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { SheetbaseField } from "./fields";
import type { DatasetQuery, SortClause } from "./query";
import type { GroupNode } from "./tree";
import { applySearch } from "./tree";
import { applyView, searchSpecFromView, type AnalysisView } from "./analysis";
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
    filterTree?: GroupNode;
  }, signal?: AbortSignal): Promise<{
    records: readonly { recordId: string; values: Record<string, unknown> }[];
    totalRows: number;
  }>;
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

export interface UseWorkbenchOptions {
  /** Active dataset fields (typically from the schema editor). */
  fields: readonly SheetbaseField[];
  /** Workspace rows — the snapshot search, explorer and rules evaluate. */
  rows: readonly Record<string, unknown>[];
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
  /** `rows` after the view's filter + sort + limit — feed explorer and rules. */
  viewRows: readonly Record<string, unknown>[];
  /** `rows` after the view's filter + sort only — the "filtered N / M" counter. */
  filteredRows: readonly Record<string, unknown>[];
  /** Ready-made `WorkspaceProvider` value. */
  workspace: WorkspaceState;
}

/**
 * The workbench composition as code: one `AnalysisView` shared between the
 * search pane and the explorer, the compiled `DatasetQuery` forwarded to the
 * table, and the derived row slices every consumer reads.
 */
export function useWorkbench(options: UseWorkbenchOptions): WorkbenchGlue {
  const { fields, rows, initialView, persistKey, adapter } = options;
  const [view, setView] = useState<AnalysisView>(() => {
    const loaded = loadInitialState(persistKey, adapter, initialView);
    return { ...initialView, ...loaded };
  });
  const [query, setQuery] = useState<DatasetQuery>({});
  const patchView = useCallback((patch: Partial<AnalysisView>) => {
    setView((current) => ({ ...current, ...patch }));
  }, []);
  const viewRows = useMemo(() => applyView(rows, view), [rows, view]);
  const filteredRows = useMemo(
    () => applySearch(rows, searchSpecFromView({ ...view, limit: undefined })),
    [rows, view],
  );
  const workspace = useMemo<WorkspaceState>(() => ({ fields, rows, query }), [fields, rows, query]);
  return { view, setView, patchView, query, setQuery, viewRows, filteredRows, workspace };
}
