import { useState } from "react";
import { RulesEngine, type PipelineRule } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch } from "sheetbase-advanced-search";
import { Explorer, DemoTable, ruleActions, ruleFields, rulesStarter, schemaStarter, searchFields, searchRows } from "./showcase";
import { Workbench } from "./Workbench";

/** Stacked reference page: all five components in a column, each owning its theme. */
function StackedDemo() {
  const [graph, setGraph] = useState<SchemaGraph>(schemaStarter);
  const [rules, setRules] = useState<PipelineRule[]>(rulesStarter);
  return (
    <div className="sb-demo-all">
      <header className="sb-demo-all-head">
        <h1>Sheetbase components</h1>
        <p>All five on one page. Each card owns its theme; the page follows when any card goes dark.</p>
      </header>
      <section aria-label="Table">
        <h2>Table</h2>
        <DemoTable />
      </section>
      <section aria-label="Explorer">
        <h2>Explorer</h2>
        <Explorer chartHeight={420} />
      </section>
      <section aria-label="Schema editor">
        <h2>Schema editor</h2>
        <SchemaEditor value={graph} onChange={setGraph} />
      </section>
      <section aria-label="Rules engine">
        <h2>Rules engine</h2>
        <RulesEngine value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} />
      </section>
      <section aria-label="Advanced search">
        <h2>Advanced search</h2>
        <AdvancedSearch fields={searchFields} rows={searchRows} />
      </section>
    </div>
  );
}

type View = "panes" | "stacked";

/** Demo shell with a switch between the pane multiplexer and the stacked reference. */
export function App() {
  const [view, setView] = useState<View>("panes");
  return (
    <>
      <nav className="sb-demo-switch" aria-label="Demo view">
        <button className={view === "panes" ? "active" : ""} onClick={() => setView("panes")}>Pane layout</button>
        <button className={view === "stacked" ? "active" : ""} onClick={() => setView("stacked")}>Stacked</button>
      </nav>
      {view === "panes" ? <Workbench /> : <StackedDemo />}
    </>
  );
}
