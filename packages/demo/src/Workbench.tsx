import { useState } from "react";
import {
  PaneLayout,
  ThemeToggleButton,
  usePersistedTheme,
  type Layout,
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

/** Starts with the table large on the left, explorer top-right, analysis tabs bottom-right. */
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
 * with drag-to-dock tabs and resizable splits, inside the shared shell.
 */
export function Workbench() {
  const { activeTheme, toggleTheme } = usePersistedTheme({});
  const [layout, setLayout] = useState<Layout>(workbenchLayout);
  const [graph, setGraph] = useState<SchemaGraph>(schemaStarter);
  const [rules, setRules] = useState<PipelineRule[]>(rulesStarter);
  const onThemeChange = () => toggleTheme();

  const panes: PaneSpec[] = [
    { id: "table", title: "Table", content: <DemoTable theme={activeTheme} onThemeChange={onThemeChange} /> },
    { id: "explorer", title: "Explorer", content: <Explorer theme={activeTheme} onThemeChange={onThemeChange} /> },
    {
      id: "schema",
      title: "Schema",
      content: <SchemaEditor value={graph} onChange={setGraph} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    {
      id: "rules",
      title: "Rules",
      content: <RulesEngine value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} theme={activeTheme} onThemeChange={onThemeChange} />,
    },
    { id: "search", title: "Search", content: <AdvancedSearch fields={searchFields} rows={searchRows} theme={activeTheme} onThemeChange={onThemeChange} /> },
  ];

  return (
    <div className="sb-demo-stage">
      <div className="sb-workbench">
        <PaneLayout
          panes={panes}
          layout={layout}
          onLayoutChange={setLayout}
          className="sb-panes--fit"
        />
      </div>
      <div className="sheetbase-scope sb-workbench-tools" data-theme={activeTheme}>
        <button className="sb-btn" onClick={() => setLayout(workbenchLayout)}>Reset layout</button>
        <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
      </div>
    </div>
  );
}
