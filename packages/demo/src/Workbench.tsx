import { useCallback, useMemo, useRef, useState } from "react";
import {
  PaneLayout,
  ThemeToggleButton,
  createLocalStorageAdapter,
  loadInitialState,
  loadPaneLayoutState,
  useIdleSave,
  usePersistedTheme,
  type Layout,
  type PaneLayoutState,
  type PaneSpec,
  type SearchSpec,
  type SheetbaseField,
} from "sheetbase-shared";
import { RulesEngine, type PipelineRule, type RulesEngineHandle } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaEditorHandle, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch, type AdvancedSearchHandle } from "sheetbase-advanced-search";
import {
  DemoTable,
  Explorer,
  ruleActions,
  ruleFields,
  rulesStarter,
  schemaStarter,
  searchFields,
  searchRows,
  sampleRows,
  tableFields,
} from "./showcase";

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
  const searchAdapter = useMemo(() => createLocalStorageAdapter<SearchSpec>(), []);
  const [graph, setGraph] = useState<SchemaGraph>(() => loadInitialState(WORKBENCH_SCHEMA_KEY, graphAdapter, schemaStarter));
  const [rules, setRules] = useState<PipelineRule[]>(() => loadInitialState(WORKBENCH_RULES_KEY, rulesAdapter, rulesStarter));
  const [headerFields, setHeaderFields] = useState<PaneField[]>(tableFields);
  const [datasetQuery, setDatasetQuery] = useState("");
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
  const onHeaderFieldsChange = useCallback((fields: ReadonlyArray<SheetbaseField & { column: number }>) => {
    // The table has no datetime column type; land it on date.
    setHeaderFields(fields.length > 0
      ? fields.map((field) => ({ id: field.id, label: field.label, column: field.column, dataType: field.dataType === "datetime" ? "date" : field.dataType }))
      : tableFields);
  }, []);

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", closable: true, content: <DemoTable fields={headerFields} theme={activeTheme} onThemeChange={onThemeChange} /> },
    { id: "explorer", title: "Explorer", closable: true, content: <Explorer theme={activeTheme} onThemeChange={onThemeChange} /> },
    {
      id: "schema",
      title: "Schema",
      closable: true,
      actions: (
        <>
          <button className="sb-btn" onClick={() => schemaRef.current?.fitView()}>Fit</button>
          <button className="sb-btn" onClick={() => schemaRef.current?.resetView()}>Reset</button>
          <button className="sb-btn primary" onClick={() => schemaRef.current?.addModel()}>+ Model</button>
        </>
      ),
      content: (
        <SchemaEditor
          ref={schemaRef}
          chrome="none"
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
      content: <RulesEngine ref={rulesRef} chrome="none" value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} rows={sampleRows} persistKey={WORKBENCH_RULES_KEY} adapter={rulesAdapter} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    {
      id: "search",
      title: "Search",
      closable: true,
      actions: <button className="sb-btn" onClick={() => searchRef.current?.clear()}>Clear</button>,
      content: (
        <AdvancedSearch
          ref={searchRef}
          chrome="none"
          fields={searchFields}
          rows={searchRows}
          persistKey={WORKBENCH_SEARCH_KEY}
          adapter={searchAdapter}
          onDatasetQueryChange={(query) => {
            const count = query?.filters?.length ?? 0;
            setDatasetQuery(count > 0 ? `${count} flat filter${count === 1 ? "" : "s"}` : "");
          }}
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
    setHeaderFields(tableFields);
  }

  return (
    <div className="sb-demo-stage">
      <div className="sb-workbench">
        <PaneLayout
          panes={panes}
          layout={layout}
          onLayoutChange={setLayout}
          persistKey={WORKBENCH_LAYOUT_KEY}
          adapter={adapter}
          onClosePane={(id) => setClosed((current) => new Set(current).add(id))}
          theme={activeTheme}
          className="sb-panes--fit sb-workbench-panes"
        />
      </div>
      <div className="sheetbase-scope sb-workbench-tools" data-theme={activeTheme}>
        {datasetQuery && <span className="sb-muted">search → {datasetQuery}</span>}
        <button className="sb-btn" onClick={reset}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
