import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaneLayout,
  SheetbaseShell,
  ThemeToggleButton,
  WorkspaceProvider,
  createLocalStorageAdapter,
  emptyView,
  loadInitialState,
  loadPaneLayoutState,
  pruneViewToFields,
  queryKey,
  toDatasetQuery,
  useIdleSave,
  usePersistedTheme,
  useWorkbench,
  type AnalysisView,
  type Layout,
  type PaneLayoutHandle,
  type PaneLayoutState,
  type PaneSpec,
  type SheetbaseField,
  type WorkspaceDataSource,
} from "sheetbase-shared";
import { RulesEngine, type PipelineRule, type RulesRemoteSource, type RuleWrite } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch } from "sheetbase-advanced-search";
import type { Dataset } from "sheetbase-explorer";
import { createMemoryPagedAdapter, DataPageCache, HttpPagedDataAdapter, type Scalar } from "sheetbase-table";
import {
  Explorer,
  createExplorerDataset,
  experimentFields,
  ruleActions,
  rulesStarter,
  schemaFromFields,
  schemaStarter,
  sampleRows,
  tableFields,
} from "./showcase";
import { QueryTable } from "./QueryTable";

const WORKBENCH_LAYOUT_KEY = "sheetbase-demo:workbench";
const WORKBENCH_CLOSED_KEY = "sheetbase-demo:workbench:closed";
const WORKBENCH_SCHEMA_KEY = "sheetbase-demo:schema";
const WORKBENCH_RULES_KEY = "sheetbase-demo:rules";
const WORKBENCH_SEARCH_KEY = "sheetbase-demo:search";
const WORKBENCH_PANE_IDS = ["table", "explorer", "schema", "rules", "search"];

/** Example API base (`bun run dev:api` in packages/table). */
const API_BASE = "http://127.0.0.1:8787";
/** Rows fetched for the remote search preview / rules affordance. */
const REMOTE_PREVIEW_ROWS = 200;
type SourceId = "sample" | "experiments";

type PaneField = { id: string; label: string; column: number; dataType: "text" | "number" | "boolean" | "date" | "datetime" | "relationship" };

/** Start with the table large on the left, explorer top-right, analysis tabs bottom-right. */
const workbenchLayout: Layout = {
  kind: "split",
  id: "wb-root",
  direction: "row",
  sizes: [0.44, 0.56],
  children: [
    { kind: "stack", id: "wb-table", panes: ["table"], active: "table" },
    {
      kind: "split",
      id: "wb-right",
      direction: "column",
      sizes: [0.6, 0.4],
      children: [
        { kind: "stack", id: "wb-explorer", panes: ["explorer"], active: "explorer" },
        { kind: "stack", id: "wb-analysis", panes: ["schema", "rules", "search"], active: "schema" },
      ],
    },
  ],
};

/**
 * Demonstrates the shared pane multiplexer: all five components docked as panes,
 * with drag-to-dock tabs and resizable splits.
 */
export function Workbench() {
  const { activeTheme, resolvedTheme, toggleTheme } = usePersistedTheme({});
  const adapter = useMemo(() => createLocalStorageAdapter<PaneLayoutState>(), []);
  const graphAdapter = useMemo(() => createLocalStorageAdapter<SchemaGraph>(), []);
  const rulesAdapter = useMemo(() => createLocalStorageAdapter<PipelineRule[]>(), []);
  const searchAdapter = useMemo(() => createLocalStorageAdapter<AnalysisView>(), []);
  const [graph, setGraph] = useState<SchemaGraph>(() => loadInitialState(WORKBENCH_SCHEMA_KEY, graphAdapter, schemaStarter));
  const [rules, setRules] = useState<PipelineRule[]>(() => loadInitialState(WORKBENCH_RULES_KEY, rulesAdapter, rulesStarter));
  const [searchPreview, setSearchPreview] = useState(false);
  const [sourceId, setSourceId] = useState<SourceId>("sample");
  const remoteActive = sourceId === "experiments";
  const datasetId = remoteActive ? "experiments" : "sample";
  const [headerFields, setHeaderFields] = useState<PaneField[]>(tableFields);
  // The table's source of truth: a host-owned paged adapter keyed on the
  // dataset's natural id (`sample_id`), plus a shared page cache the apply
  // path can invalidate. The table re-reads this adapter after a rules apply.
  // Local and remote adapters are both held so switching source doesn't lose
  // local edits.
  const [localAdapter] = useState(() => createMemoryPagedAdapter(sampleRows.map((row) => ({
    recordId: row.sample_id,
    values: row as Record<string, Scalar>,
  }))));
  const [remoteAdapter] = useState(() => new HttpPagedDataAdapter(`${API_BASE}/api/table`));
  const tableAdapter = remoteActive ? remoteAdapter : localAdapter;
  const [tablePageCache] = useState(() => new DataPageCache(48));
  // Bumping remounts the table pane so it re-reads committed adapter state.
  const [applyTick, setApplyTick] = useState(0);
  // Workspace rows: the snapshot search, explorer and rules evaluate. Rules
  // write-back mirrors accepted commits into it so every pane stays coherent.
  const [rows, setRows] = useState(sampleRows);
  // The remote workspace source: the table's own HTTP adapter for pages
  // (queryKey computed per request so the page cache keys correctly) plus a
  // bridge to the explorer aggregate endpoint.
  const remoteSource = useMemo<WorkspaceDataSource>(() => ({
    fetchPage: async (request, signal) => {
      const page = await remoteAdapter.fetchPage({
        datasetId: request.datasetId,
        rowStart: request.rowStart,
        rowCount: request.rowCount,
        fieldIds: request.fieldIds,
        queryKey: queryKey({ sort: request.sort, filters: request.filters, filterLogic: request.filterLogic, filterTree: request.filterTree }),
        sort: request.sort,
        filters: request.filters,
        filterLogic: request.filterLogic,
        filterTree: request.filterTree,
      }, signal);
      return { records: page.records, totalRows: page.totalRows, revision: page.revision };
    },
    aggregate: async (query, signal) => {
      const response = await fetch(`${API_BASE}/api/explorer/aggregate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId: "experiments", ...query }),
        signal: signal ?? null,
      });
      if (!response.ok) throw new Error(`Aggregate request failed (${response.status})`);
      return response.json();
    },
  }), [remoteAdapter]);
  // One shared analysis view: search edits it and the explorer charts through
  // it; the compiled query feeds the table. `useWorkbench` owns that dataflow —
  // over materialised rows locally, or the remote source for server datasets.
  const wb = useWorkbench({
    fields: headerFields as readonly SheetbaseField[],
    ...(remoteActive ? { source: remoteSource } : { rows }),
    initialView: emptyView("mean"),
    persistKey: WORKBENCH_SEARCH_KEY,
    adapter: searchAdapter,
  });
  const { view, setView, patchView, setQuery, viewRows, filteredRows } = wb;
  // Remote affordances: a filtered first page feeds the search preview, and
  // the totals drive the "filtered N / M" counter. Both re-run when the
  // compiled query changes — the tree is evaluated server-side.
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [remoteTotals, setRemoteTotals] = useState<{ matched: number; total: number } | null>(null);
  useEffect(() => {
    if (!remoteActive) {
      setPreviewRows([]);
      setRemoteTotals(null);
      return;
    }
    const controller = new AbortController();
    const fieldIds = headerFields.map((field) => field.id);
    Promise.all([
      remoteSource.fetchPage({ datasetId, rowStart: 0, rowCount: 1, fieldIds: fieldIds.slice(0, 1) }, controller.signal),
      remoteSource.fetchPage({ datasetId, rowStart: 0, rowCount: REMOTE_PREVIEW_ROWS, fieldIds, sort: wb.query.sort, filters: wb.query.filters, filterLogic: wb.query.filterLogic, filterTree: wb.query.filterTree }, controller.signal),
    ]).then(([all, filtered]) => {
      if (controller.signal.aborted) return;
      setPreviewRows(filtered.records.map((record) => record.values));
      setRemoteTotals({ total: all.totalRows, matched: filtered.totalRows });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setPreviewRows([]);
        setRemoteTotals(null);
      }
    });
    return () => controller.abort();
  }, [remoteActive, remoteSource, datasetId, wb.query, headerFields]);
  // The rules pane's server-backed sample: pages come from the same remote
  // source the table reads, so dry-run recordIds are real and apply commits
  // land through the HTTP adapter. `remoteTotals.total` (the unfiltered
  // dataset size) feeds the scope label once the preview fetch lands.
  const remoteRulesSource = useMemo<RulesRemoteSource>(() => ({
    fetchSample: async ({ rowStart, rowCount, filterTree }) => {
      const page = await remoteSource.fetchPage({
        datasetId: "experiments",
        rowStart,
        rowCount,
        fieldIds: headerFields.map((field) => field.id),
        filterTree,
      }, undefined);
      return {
        rows: page.records.map((record) => record.values as Record<string, unknown>),
        recordIds: page.records.map((record) => record.recordId),
        totalRows: page.totalRows,
      };
    },
    totalRows: remoteTotals?.total,
  }), [remoteSource, headerFields, remoteTotals]);
  const recordIdOf = useCallback((row: Record<string, unknown>) =>
    typeof row.sample_id === "string" ? row.sample_id : undefined, []);
  const onApplyWrites = useCallback(async (writes: readonly RuleWrite[]) => {
    const result = await tableAdapter.commit(writes.map((write) => ({ datasetId, ...write })));
    if (result.accepted.length > 0) {
      const patches = new Map<string, Record<string, unknown>>();
      for (const write of result.accepted) {
        const patch = patches.get(write.recordId) ?? {};
        patch[write.fieldId] = write.after ?? "";
        patches.set(write.recordId, patch);
      }
      setRows((current) => current.map((row) => {
        const patch = patches.get(row.sample_id);
        return patch ? { ...row, ...patch } : row;
      }));
      tablePageCache.invalidateDataset(datasetId);
      setApplyTick((tick) => tick + 1);
    }
    return { applied: result.accepted.length, rejected: result.rejected.length };
  }, [tableAdapter, tablePageCache, datasetId]);
  // Pipeline: the schema's fields feed search, search filters the rows, rules
  // evaluate the filtered rows, the table shows the raw rows.
  // Field objects (not ids) so numeric/date fields offer >, <, between, etc.
  const activeSearchFields = useMemo(
    () => headerFields.map((field) => ({ id: field.id, label: field.label, dataType: field.dataType })),
    [headerFields],
  );
  // On remote sources the explorer charts through the source's aggregate
  // capability (rows stay server-side); locally it charts the view rows.
  const explorerDataset = useMemo<Dataset | null>(() => {
    if (remoteActive) {
      return {
        name: "Experiments (remote)",
        rows: [],
        columns: headerFields.map((field) => ({
          key: field.id,
          kind: field.dataType === "number" ? "number" as const
            : field.dataType === "boolean" ? "boolean" as const
              : field.dataType === "date" || field.dataType === "datetime" ? "date" as const
                : "string" as const,
          nullable: true,
          uniqueCount: 0,
        })),
        source: "workspace-remote",
        remote: {
          aggregate: async (query, signal) => {
            if (!remoteSource.aggregate) throw new Error("Remote source has no aggregate capability");
            return remoteSource.aggregate(query, signal);
          },
          page: async (query, signal) => {
            const page = await remoteSource.fetchPage(
              { datasetId: "experiments", rowStart: query.offset, rowCount: query.limit, fieldIds: query.fields, filterTree: query.filter },
              signal,
            );
            return {
              rows: page.records.map((record, index) => ({ ...record.values, __sheetbaseRowId: query.offset + index })),
              totalRows: page.totalRows,
              revision: page.revision,
            };
          },
        },
      };
    }
    return createExplorerDataset((viewRows ?? []) as readonly Record<string, unknown>[], headerFields);
  }, [remoteActive, viewRows, headerFields, remoteSource]);
  const closedAdapter = useMemo(() => createLocalStorageAdapter<string[]>(), []);
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () => new Set(loadInitialState(WORKBENCH_CLOSED_KEY, closedAdapter, [] as string[])),
  );
  const closedList = useMemo(() => [...closed], [closed]);
  useIdleSave(WORKBENCH_CLOSED_KEY, closedList, closedAdapter);
  const visibleIds = useMemo(() => WORKBENCH_PANE_IDS.filter((id) => !closed.has(id)), [closed]);
  const [layout, setLayout] = useState<Layout>(() =>
    loadPaneLayoutState(adapter, WORKBENCH_LAYOUT_KEY, visibleIds, workbenchLayout),
  );
  const onThemeChange = () => toggleTheme();
  const panesRef = useRef<PaneLayoutHandle>(null);
  const onHeaderFieldsChange = useCallback((fields: ReadonlyArray<SheetbaseField & { column: number }>) => {
    const nextFields = fields.length > 0
      ? fields.map((field) => ({ id: field.id, label: field.label, column: field.column, dataType: field.dataType }))
      : tableFields;
    setHeaderFields(nextFields);
    // The view is dataset-relative: a schema edit that removes a field drops
    // the conditions/bindings referencing it rather than letting them compile
    // into the shared query.
    setView((current) => pruneViewToFields(current, nextFields));
  }, [setView]);

  /** Swap between the materialised sample dataset and the remote example API.
   *  Resets the field set + schema graph to the source's own columns, and
   *  re-homes the shared view: references to fields the new source lacks are
   *  pruned (a stale field must never compile into remote requests), while
   *  conditions on fields both datasets carry (status, sample_id) survive. */
  function switchSource(next: SourceId) {
    if (next === sourceId) return;
    setSourceId(next);
    const fields = next === "experiments" ? experimentFields : tableFields;
    setHeaderFields(fields);
    setGraph(schemaFromFields(fields, next, next === "experiments" ? "Experiments" : "Sample"));
    const nextView = pruneViewToFields(view, fields);
    setView(nextView);
    // Recompile immediately — otherwise the outgoing query fires once more
    // against the new dataset before AdvancedSearch re-emits.
    setQuery(toDatasetQuery(nextView.filter, nextView.sort ? [{ fieldId: nextView.sort.field, direction: nextView.sort.direction }] : undefined));
  }

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", closable: true, content: <QueryTable key={`${datasetId}:${applyTick}`} theme={resolvedTheme} adapter={tableAdapter} pageCache={tablePageCache} datasetId={datasetId} /> },
    { id: "explorer", title: "Explorer", closable: true, content: explorerDataset ? <Explorer dataset={explorerDataset} view={view} onViewChange={setView} theme={activeTheme} onThemeChange={onThemeChange} showPanel={false} /> : null },
    {
      id: "schema",
      title: "Schema",
      closable: true,
      actions: (
        <button type="button" className="sb-btn" title="Rebuild the schema from the table's columns" onClick={() => setGraph(schemaFromFields(headerFields, datasetId, remoteActive ? "Experiments" : "Sample"))}>From table</button>
      ),
      content: (
        <SchemaEditor
          value={graph}
          onChange={setGraph}
          onHeaderFieldsChange={onHeaderFieldsChange}
          persistKey={WORKBENCH_SCHEMA_KEY}
          adapter={graphAdapter}
          theme={activeTheme}
          onThemeChange={onThemeChange}
        />
      ),
    },
    {
      id: "rules",
      title: "Rules",
      closable: true,
      content: (
        <RulesEngine
          value={rules}
          onChange={setRules}
          fields={headerFields.map((field) => field.id)}
          actions={ruleActions}
          {...(remoteActive
            ? { source: remoteRulesSource, filterTree: wb.query.filterTree }
            : { rows: viewRows ?? [], recordIdOf })}
          onApplyWrites={onApplyWrites}
          persistKey={WORKBENCH_RULES_KEY}
          adapter={rulesAdapter}
          theme={activeTheme}
          onThemeChange={onThemeChange}
        />
      ),
    },
    {
      id: "search",
      title: "Search",
      closable: true,
      content: (
        <AdvancedSearch
          value={view}
          onChange={patchView}
          preview={searchPreview}
          onPreviewChange={setSearchPreview}
          onDatasetQueryChange={setQuery}
          fields={activeSearchFields}
          rows={remoteActive ? previewRows : rows}
          persistKey={WORKBENCH_SEARCH_KEY}
          adapter={searchAdapter}
          theme={activeTheme}
          onThemeChange={onThemeChange}
        />
      ),
    },
  ].filter((pane) => !closed.has(pane.id));

  function reset() {
    setClosed(new Set());
    setLayout(workbenchLayout);
    setSourceId("sample");
    setGraph(schemaStarter);
    setRules(rulesStarter);
    // Same recompile-on-swap rule as switchSource: the outgoing query must not
    // fire once against the reset dataset before the search pane re-emits.
    const next = emptyView("mean");
    setView(next);
    setQuery(toDatasetQuery(next.filter));
    setHeaderFields(tableFields);
    setRows(sampleRows);
  }

  // "New pane…" in a pane menu re-opens the first closed pane into that stack.
  function requestNewPane(stackId: string) {
    const next = WORKBENCH_PANE_IDS.find((id) => closed.has(id));
    if (!next) return;
    setClosed((current) => {
      const copy = new Set(current);
      copy.delete(next);
      return copy;
    });
    panesRef.current?.addPane(next, stackId);
  }

  return (
    <div className="sb-demo-stage">
      <WorkspaceProvider value={wb.workspace}>
        <SheetbaseShell theme={activeTheme} header={false} className="sb-demo-workbench">
          <PaneLayout
          ref={panesRef}
          panes={panes}
          layout={layout}
          onLayoutChange={setLayout}
          persistKey={WORKBENCH_LAYOUT_KEY}
          adapter={adapter}
          onClosePane={(id) => setClosed((current) => new Set(current).add(id))}
          onRequestNewPane={requestNewPane}
          paneMenu="hover"
          surface="shared"
          theme={activeTheme}
          className="sb-panes--fit sb-workbench-panes"
        />
        </SheetbaseShell>
      </WorkspaceProvider>
      <div className="sheetbase-scope sb-workbench-tools" data-theme={resolvedTheme}>
        {!remoteActive && filteredRows && filteredRows.length !== rows.length && <span className="sb-muted">filtered {filteredRows.length} / {rows.length} rows</span>}
        {remoteActive && remoteTotals && remoteTotals.matched !== remoteTotals.total && <span className="sb-muted">filtered {remoteTotals.matched.toLocaleString()} / {remoteTotals.total.toLocaleString()} rows</span>}
        <select className="sb-btn" aria-label="Data source" value={sourceId} onChange={(event) => switchSource(event.target.value as SourceId)}>
          <option value="sample">Sample (local)</option>
          <option value="experiments">Experiments API (remote)</option>
        </select>
        <span className="sb-muted" title="demo build">{__BUILD__}</span>
        <button type="button" className="sb-btn" onClick={reset}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
