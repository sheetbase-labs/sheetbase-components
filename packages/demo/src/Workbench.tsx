import { useMemo, useState } from "react";
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
} from "sheetbase-shared";
import { RulesEngine, type PipelineRule } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch } from "sheetbase-advanced-search";
import {
  DemoTable,
  Explorer,
  ruleActions,
  ruleFields,
  rulesStarter,
  schemaStarter,
  searchFields,
  searchRows,
} from "./showcase";

const WORKBENCH_LAYOUT_KEY = "sheetbase-demo:workbench";
const WORKBENCH_CLOSED_KEY = "sheetbase-demo:workbench:closed";
const WORKBENCH_PANE_IDS = ["table", "explorer", "schema", "rules", "search"];

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
  const [graph, setGraph] = useState<SchemaGraph>(schemaStarter);
  const [rules, setRules] = useState<PipelineRule[]>(rulesStarter);
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

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", closable: true, content: <DemoTable theme={activeTheme} onThemeChange={onThemeChange} /> },
    { id: "explorer", title: "Explorer", closable: true, content: <Explorer theme={activeTheme} onThemeChange={onThemeChange} /> },
    {
      id: "schema",
      title: "Schema",
      closable: true,
      content: <SchemaEditor value={graph} onChange={setGraph} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    {
      id: "rules",
      title: "Rules",
      closable: true,
      content: <RulesEngine value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    { id: "search", title: "Search", closable: true, content: <AdvancedSearch fields={searchFields} rows={searchRows} theme={activeTheme} onThemeChange={onThemeChange} /> },
  ].filter((pane) => !closed.has(pane.id));

  function reset() {
    setClosed(new Set());
    setLayout(workbenchLayout);
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
          className="sb-panes--fit"
        />
      </div>
      <div className="sheetbase-scope sb-workbench-tools" data-theme={activeTheme}>
        <button className="sb-btn" onClick={reset}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
