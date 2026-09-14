import { useState, type ReactNode } from "react";
import { RulesEngine, type PipelineRule } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch } from "sheetbase-advanced-search";
import { Explorer, DemoTable, ruleActions, ruleFields, rulesStarter, schemaStarter, searchFields, searchRows, createExplorerDataset, sampleRows } from "./showcase";

interface PropRow { name: string; type: string; desc: string }
interface Section {
  id: string;
  title: string;
  pkg?: string;
  blurb: string;
  props?: PropRow[];
  snippet?: string;
}

const SHARED: PropRow[] = [
  { name: "theme / defaultTheme", type: "'light' | 'dark'", desc: "Controlled or uncontrolled theme; every component renders its own scope." },
  { name: "persistKey + adapter", type: "string + PersistenceAdapter", desc: "Idle-scheduled state persistence (localStorage, HTTP, …)." },
  { name: 'chrome', type: '"full" | "none"', desc: "Drop the component topbar when a host owns pane chrome." },
];

const SECTIONS: Section[] = [
  {
    id: "table",
    title: "Table",
    pkg: "sheetbase-table",
    blurb: "The data grid — virtualised to a million rows, paged data sources, formulas, conditional formats, bound or unbound writes. Bound grids delegate persistence to the host via recordIdForRow.",
    snippet: `import { Spreadsheet, createHttpAdapter } from "sheetbase-table";\n\n<Spreadsheet\n  datasetHeader={{ fields, recordIdForRow }}\n  adapter={persistence}\n  onFieldWrite={commit}\n/>`,
    props: [
      { name: "datasetHeader", type: "{ fields, recordIdForRow? }", desc: "Field contract; supplying recordIdForRow makes the grid host-bound." },
      { name: "onFieldWrite(s)", type: "(writes) => void", desc: "Cell/bulk writes through the runFieldWrite path — hosts commit." },
      { name: "query / onQueryChange", type: "DatasetQuery", desc: "Sort/filter/limit state; filterTree is authoritative when present." },
      { name: "adapter", type: "PersistenceAdapter", desc: "Presentation state (columns, formats, query) persisted idle." },
      ...SHARED,
    ],
  },
  {
    id: "explorer",
    title: "Explorer",
    pkg: "sheetbase-explorer",
    blurb: "Charting and aggregation over a Dataset — local rows or a remote source that aggregates (and now pages) on the server. A host-provided AnalysisView overrides the chart spec's slice.",
    snippet: `import { Explorer, createHttpExplorerAdapter } from "sheetbase-explorer";\n\n<Explorer\n  dataset={dataset}\n  view={view} onViewChange={setView}\n/>`,
    props: [
      { name: "dataset", type: "Dataset", desc: "Columns + rows; remote sources pass rows: [] plus a remote block." },
      { name: "remote.aggregate / remote.page", type: "fns", desc: "Server-side aggregation and optional first-page row preview." },
      { name: "view / onViewChange", type: "AnalysisView", desc: "Shared analysis state — filters/group/sort/limit applied to the slice." },
      { name: "sources", type: "DataAdapter[]", desc: "Pluggable dataset pickers (http adapter ships in-box)." },
      ...SHARED.filter((p) => p.name !== "chrome"),
    ],
  },
  {
    id: "schema",
    title: "Schema editor",
    pkg: "sheetbase-schemaeditor",
    blurb: "A canvas for table models — nodes, relationship edges, inspector edits. Emits Postgres-flavoured DDL and provisioning payloads, imports create-table DDL back into a graph, and draws query SQL — Trino, Postgres, dbt — as an ERD.",
    snippet: `import { SchemaEditor, graphToDdl, ddlToGraph, analyzeSql } from "sheetbase-schemaeditor";\n\n<SchemaEditor\n  value={graph} onChange={setGraph}\n  onHeaderFieldsChange={(fields) => setTableFields(fields)}\n/>`,
    props: [
      { name: "value / initialGraph", type: "SchemaGraph", desc: "Controlled graph or uncontrolled seed." },
      { name: "onHeaderFieldsChange", type: "(fields, model) => void", desc: "Selected model → SheetbaseField[] — the schema→grid materialisation path." },
      { name: "graphToDdl / graphToProvision", type: "fns", desc: "Emit create-table SQL or a provisioning payload; throw on invalid graphs." },
      { name: "ddlToGraph", type: "(sql) => SchemaGraph", desc: "Import direction for create-table DDL." },
      { name: "analyzeSql / sqlToGraph", type: "(sql) => SqlAnalysis", desc: "Query import: tables, joins, CTEs, result columns + warnings. dbt refs/sources expand." },
      ...SHARED,
    ],
  },
  {
    id: "rules",
    title: "Rules engine",
    pkg: "sheetbase-rulesengine",
    blurb: "A natural-language rule pipeline — 'when status is failed then set triage to urgent'. Dry-run evaluates every rule over the dataset; auto-apply commits transform writes live through the host.",
    snippet: `import { RulesEngine, parseNaturalLanguageRule } from "sheetbase-rulesengine";\n\n<RulesEngine\n  value={rules} onChange={setRules}\n  rows={rows} recordIdOf={recordIdOf}\n  onApplyWrites={commitWrites}\n/>`,
    props: [
      { name: "value / initialRules", type: "PipelineRule[]", desc: "Controlled rules or uncontrolled seed." },
      { name: "rows + recordIdOf", type: "Row[] + fn", desc: "Dataset for the dry-run pane; recordIdOf resolves rows to host record ids." },
      { name: "onApplyWrites", type: "(writes, ctx) => Promise", desc: "Commit boundary for transform writes — enables Apply and the auto-apply toggle." },
      { name: "actions", type: "RuleActionDef[]", desc: "Host-declared action vocabulary for the kind editors." },
      ...SHARED,
    ],
  },
  {
    id: "search",
    title: "Advanced search",
    pkg: "sheetbase-advanced-search",
    blurb: "Nested boolean filter trees — groups, combinators, per-field operators. Compiles to a DatasetQuery for the host pipeline and previews live matches.",
    snippet: `import { AdvancedSearch } from "sheetbase-advanced-search";\n\n<AdvancedSearch\n  fields={fields} rows={rows}\n  onDatasetQueryChange={setQuery}\n/>`,
    props: [
      { name: "fields", type: "SearchFieldInput[]", desc: "Field objects with dataType — numeric/date fields get range operators." },
      { name: "rows", type: "SearchRow[]", desc: "Rows for the live match preview pane." },
      { name: "onDatasetQueryChange", type: "(query) => void", desc: "Emits the compiled DatasetQuery (filterTree authoritative)." },
      { name: "preview", type: "boolean", desc: "Toggle the match-preview pane." },
      ...SHARED,
    ],
  },
];

/** Sidebar docs: each package gets a live instance, key props and a usage snippet. */
export function DocsSite() {
  const [activeId, setActiveId] = useState("overview");
  const [graph, setGraph] = useState<SchemaGraph>(schemaStarter);
  const [rules, setRules] = useState<PipelineRule[]>(rulesStarter);
  const active = SECTIONS.find((s) => s.id === activeId);
  // Live instances keyed by section id — fully interactive, not screenshots.
  const live: Record<string, ReactNode> = {
    table: <DemoTable />,
    explorer: <Explorer dataset={createExplorerDataset(sampleRows)} chartHeight={360} showPanel={false} />,
    schema: <SchemaEditor value={graph} onChange={setGraph} />,
    rules: <RulesEngine value={rules} onChange={setRules} fields={ruleFields} actions={ruleActions} />,
    search: <AdvancedSearch fields={searchFields} rows={searchRows} />,
  };
  return (
    <div className="sb-docs sheetbase-scope" data-theme="light">
      <aside className="sb-docs-nav">
        <div className="sb-docs-brand">sheetbase</div>
        <button type="button" className={activeId === "overview" ? "active" : ""} onClick={() => setActiveId("overview")}>Overview</button>
        {SECTIONS.map((s) => (
          <button type="button" key={s.id} className={activeId === s.id ? "active" : ""} onClick={() => setActiveId(s.id)}>{s.title}</button>
        ))}
      </aside>
      <main className="sb-docs-main">
        {activeId === "overview" ? (
          <article>
            <h1>Sheetbase components</h1>
            <p>Six packages, one design system: a virtualised grid, a charting explorer, a schema canvas, a natural-language rules pipeline, a nested-filter search, and the shared contracts/shell they all compose through.</p>
            <h2>Install</h2>
            <pre><code>bun add sheetbase-shared sheetbase-table sheetbase-explorer sheetbase-schemaeditor sheetbase-rulesengine sheetbase-advanced-search</code></pre>
            <h2>Contracts</h2>
            <p>Shared types live in <code>sheetbase-shared</code>: <code>SheetbaseField</code> / <code>FieldDataType</code>, <code>FilterNode</code> trees, <code>DatasetQuery</code> + <code>queryKey</code>, <code>buildPredicate</code>, and the theme CSS every component scopes via <code>.sheetbase-scope</code>. Cross-component state flows through <code>AnalysisView</code> and <code>DatasetQuery.filterTree</code> — the tree is authoritative where both forms exist.</p>
            <p>The workbench in this repo composes all five components against one dataset — open the <strong>Pane layout</strong> view for the multiplexer, or <strong>Stacked</strong> for all five on a page.</p>
          </article>
        ) : active ? (
          <article key={active.id}>
            <h1>{active.title}</h1>
            {active.pkg && <p className="sb-docs-pkg"><code>bun add {active.pkg}</code></p>}
            <p>{active.blurb}</p>
            <div className="sb-docs-live">{live[active.id]}</div>
            {active.props && (
              <>
                <h2>Key props</h2>
                <table className="sb-docs-props">
                  <thead><tr><th>Prop</th><th>Type</th><th>Notes</th></tr></thead>
                  <tbody>
                    {active.props.map((p) => <tr key={p.name}><td><code>{p.name}</code></td><td><code>{p.type}</code></td><td>{p.desc}</td></tr>)}
                  </tbody>
                </table>
              </>
            )}
            {active.snippet && (<><h2>Usage</h2><pre><code>{active.snippet}</code></pre></>)}
          </article>
        ) : null}
      </main>
    </div>
  );
}
