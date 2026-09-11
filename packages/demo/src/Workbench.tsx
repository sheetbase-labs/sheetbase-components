import { useCallback, useMemo, useRef, useState } from "react";
import {
  PaneLayout,
  SheetbaseShell,
  ThemeToggleButton,
  WorkspaceProvider,
  applySearch,
  applyView,
  createLocalStorageAdapter,
  emptyView,
  searchSpecFromView,
  loadInitialState,
  loadPaneLayoutState,
  useIdleSave,
  usePersistedTheme,
  type AnalysisView,
  type DatasetQuery,
  type Layout,
  type PaneLayoutHandle,
  type PaneLayoutState,
  type PaneSpec,
  type SheetbaseField,
} from "sheetbase-shared";
import { RulesEngine, type PipelineRule, type RuleWrite, type RulesEngineHandle } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaEditorHandle, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch, type AdvancedSearchHandle } from "sheetbase-advanced-search";
import { createMemoryPagedAdapter, DataPageCache, type Scalar } from "sheetbase-table";
import {
  Explorer,
  createExplorerDataset,
  ruleActions,
  ruleFields,
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
  const { activeTheme, toggleTheme } = usePersistedTheme({});
  const adapter = useMemo(() => createLocalStorageAdapter<PaneLayoutState>(), []);
  const graphAdapter = useMemo(() => createLocalStorageAdapter<SchemaGraph>(), []);
  const rulesAdapter = useMemo(() => createLocalStorageAdapter<PipelineRule[]>(), []);
  const searchAdapter = useMemo(() => createLocalStorageAdapter<AnalysisView>(), []);
  const [graph, setGraph] = useState<SchemaGraph>(() => loadInitialState(WORKBENCH_SCHEMA_KEY, graphAdapter, schemaStarter));
  const [rules, setRules] = useState<PipelineRule[]>(() => loadInitialState(WORKBENCH_RULES_KEY, rulesAdapter, rulesStarter));
  // One shared analysis view: search edits it and the explorer charts through it.
  const [view, setView] = useState<AnalysisView>(() => {
    const fallback = emptyView("mean");
    const loaded = loadInitialState(WORKBENCH_SEARCH_KEY, searchAdapter, fallback);
    return { ...fallback, ...loaded, summary: loaded.summary ?? "mean" };
  });
  const [query, setQuery] = useState<DatasetQuery>({});
  const [searchPreview, setSearchPreview] = useState(false);
  const [headerFields, setHeaderFields] = useState<PaneField[]>(tableFields);
  // The table's source of truth: a host-owned paged adapter keyed on the
  // dataset's natural id (`sample_id`), plus a shared page cache the apply
  // path can invalidate. The table re-reads this adapter after a rules apply.
  const [tableAdapter] = useState(() => createMemoryPagedAdapter(sampleRows.map((row) => ({
    recordId: row.sample_id,
    values: row as Record<string, Scalar>,
  }))));
  const [tablePageCache] = useState(() => new DataPageCache(48));
  // Bumping remounts the table pane so it re-reads committed adapter state.
  const [applyTick, setApplyTick] = useState(0);
  // Workspace rows: the snapshot search, explorer and rules evaluate. Rules
  // write-back mirrors accepted commits into it so every pane stays coherent.
  const [rows, setRows] = useState(sampleRows);
  const workspace = useMemo(
    () => ({ fields: headerFields as readonly SheetbaseField[], rows, query }),
    [headerFields, rows, query],
  );
  const recordIdOf = useCallback((row: Record<string, unknown>) =>
    typeof row.sample_id === "string" ? row.sample_id : undefined, []);
  const onApplyWrites = useCallback(async (writes: readonly RuleWrite[]) => {
    const result = await tableAdapter.commit(writes.map((write) => ({ datasetId: "sample", ...write })));
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
      tablePageCache.invalidateDataset("sample");
      setApplyTick((tick) => tick + 1);
    }
    return { applied: result.accepted.length, rejected: result.rejected.length };
  }, [tableAdapter, tablePageCache]);
  // Pipeline: the schema's fields feed search, search filters the rows, rules
  // evaluate the filtered rows, the table shows the raw rows.
  // Field objects (not ids) so numeric/date fields offer >, <, between, etc.
  const activeSearchFields = useMemo(
    () => headerFields.map((field) => ({ id: field.id, label: field.label, dataType: field.dataType })),
    [headerFields],
  );
  // The full view (filter + sort + limit) drives the explorer and rules; the
  // table's query has no limit, so the row counter tracks filter + sort only.
  const viewRows = useMemo(() => applyView(rows, view), [rows, view]);
  const filteredRows = useMemo(
    () => applySearch(rows, searchSpecFromView({ ...view, limit: undefined })),
    [rows, view],
  );
  const explorerDataset = useMemo(
    () => createExplorerDataset(viewRows as readonly Record<string, unknown>[], headerFields),
    [viewRows, headerFields],
  );
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
  const schemaRef = useRef<SchemaEditorHandle>(null);
  const rulesRef = useRef<RulesEngineHandle>(null);
  const searchRef = useRef<AdvancedSearchHandle>(null);
  const panesRef = useRef<PaneLayoutHandle>(null);
  const onHeaderFieldsChange = useCallback((fields: ReadonlyArray<SheetbaseField & { column: number }>) => {
    setHeaderFields(fields.length > 0
      ? fields.map((field) => ({ id: field.id, label: field.label, column: field.column, dataType: field.dataType }))
      : tableFields);
  }, []);

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", closable: true, content: <QueryTable key={applyTick} theme={activeTheme} adapter={tableAdapter} pageCache={tablePageCache} /> },
    { id: "explorer", title: "Explorer", closable: true, content: <Explorer dataset={explorerDataset} view={view} onViewChange={setView} theme={activeTheme} onThemeChange={onThemeChange} showPanel={false} /> },
    {
      id: "schema",
      title: "Schema",
      closable: true,
      actions: (
        <>
          <button className="sb-btn" onClick={() => schemaRef.current?.fitView()}>Fit</button>
          <button className="sb-btn" onClick={() => schemaRef.current?.resetView()}>Reset</button>
          <button className="sb-btn" title="Rebuild the schema from the table's columns" onClick={() => setGraph(schemaFromFields(headerFields, "sample", "Sample"))}>From table</button>
          <button className="sb-btn primary" onClick={() => schemaRef.current?.addModel()}>+ Model</button>
        </>
      ),
      content: ({ tabbed }: { tabbed: boolean }) => (
        <SchemaEditor
          ref={schemaRef}
          chrome={tabbed ? "none" : "full"}
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
      actions: <button className="sb-btn primary" onClick={() => rulesRef.current?.addRule()}>+ Rule</button>,
      content: ({ tabbed }: { tabbed: boolean }) => <RulesEngine ref={rulesRef} chrome={tabbed ? "none" : "full"} value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} rows={viewRows} recordIdOf={recordIdOf} onApplyWrites={onApplyWrites} persistKey={WORKBENCH_RULES_KEY} adapter={rulesAdapter} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    {
      id: "search",
      title: "Search",
      closable: true,
      actions: (
        <>
          <button className={searchPreview ? "sb-btn" : "sb-btn subtle"} aria-pressed={searchPreview} onClick={() => setSearchPreview((value) => !value)}>Preview</button>
          <button className="sb-btn" onClick={() => searchRef.current?.clear()}>Clear</button>
        </>
      ),
      content: ({ tabbed }: { tabbed: boolean }) => (
        <AdvancedSearch
          ref={searchRef}
          chrome={tabbed ? "none" : "full"}
          value={view}
          onChange={(next) => setView((current) => ({ ...current, ...next }))}
          preview={searchPreview}
          onPreviewChange={setSearchPreview}
          onDatasetQueryChange={setQuery}
          fields={activeSearchFields}
          rows={rows}
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
    setGraph(schemaStarter);
    setRules(rulesStarter);
    setView(emptyView("mean"));
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
      <WorkspaceProvider value={workspace}>
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
      <div className="sheetbase-scope sb-workbench-tools" data-theme={activeTheme}>
        {filteredRows.length !== rows.length && <span className="sb-muted">filtered {filteredRows.length} / {rows.length} rows</span>}
        <span className="sb-muted" title="demo build">{__BUILD__}</span>
        <button className="sb-btn" onClick={reset}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
