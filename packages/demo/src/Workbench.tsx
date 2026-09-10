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
import { RulesEngine, type PipelineRule, type RulesEngineHandle } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaEditorHandle, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch, type AdvancedSearchHandle } from "sheetbase-advanced-search";
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

type PaneField = { id: string; label: string; column: number; dataType: "text" | "number" | "boolean" | "date" | "relationship" };

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
  const workspace = useMemo(
    () => ({ fields: headerFields as readonly SheetbaseField[], rows: sampleRows, query }),
    [headerFields, query],
  );
  // Pipeline: the schema's fields feed search, search filters the rows, rules
  // evaluate the filtered rows, the table shows the raw rows.
  // Field objects (not ids) so numeric/date fields offer >, <, between, etc.
  const activeSearchFields = useMemo(
    () => headerFields.map((field) => ({ id: field.id, label: field.label, dataType: field.dataType })),
    [headerFields],
  );
  // The full view (filter + sort + limit) drives the explorer and rules; the
  // table's query has no limit, so the row counter tracks filter + sort only.
  const viewRows = useMemo(() => applyView(sampleRows, view), [view]);
  const filteredRows = useMemo(
    () => applySearch(sampleRows, searchSpecFromView({ ...view, limit: undefined })),
    [view],
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
    // The table has no datetime column type; land it on date.
    setHeaderFields(fields.length > 0
      ? fields.map((field) => ({ id: field.id, label: field.label, column: field.column, dataType: field.dataType === "datetime" ? "date" : field.dataType }))
      : tableFields);
  }, []);

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", closable: true, content: <QueryTable theme={activeTheme} /> },
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
      content: ({ tabbed }: { tabbed: boolean }) => <RulesEngine ref={rulesRef} chrome={tabbed ? "none" : "full"} value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} rows={viewRows} persistKey={WORKBENCH_RULES_KEY} adapter={rulesAdapter} theme={activeTheme} onThemeChange={onThemeChange} />,
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
          onDatasetQueryChange={(next) => setQuery(next ?? {})}
          fields={activeSearchFields}
          rows={sampleRows}
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
        {filteredRows.length !== sampleRows.length && <span className="sb-muted">filtered {filteredRows.length} / {sampleRows.length} rows</span>}
        <span className="sb-muted" title="demo build">{__BUILD__}</span>
        <button className="sb-btn" onClick={reset}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
