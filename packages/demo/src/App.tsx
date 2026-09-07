import { useMemo, useRef, useState } from "react";
import {
  TableSurface,
  TableFormattingToolbar,
  Spreadsheet,
  createLocalStoragePresentationAdapter,
  useTablePresentationState,
  useResolvedTheme,
  type SpreadsheetHandle,
  type SpreadsheetSelection,
  type TablePresentationState,
} from "sheetbase-table";
import { App as Explorer } from "sheetbase-explorer";
import { RulesEngine, parseNaturalLanguageRule, sampleRuleActions, type PipelineRule } from "sheetbase-rulesengine";
import { SchemaEditor, type SchemaGraph } from "sheetbase-schemaeditor";
import { AdvancedSearch, type SearchRow } from "sheetbase-advanced-search";

const tableFields = [
  { id: "sample_id", label: "sample_id", column: 0, dataType: "text" as const },
  { id: "donor", label: "donor", column: 1, dataType: "text" as const },
  { id: "material", label: "material", column: 2, dataType: "text" as const },
];

const tableFallback: TablePresentationState = {
  version: 2,
  theme: "system",
  conditionalFormats: [],
  formats: [],
  objects: [],
  query: {},
  columns: tableFields.map((field) => ({ fieldId: field.id })),
  frozenColumns: 0,
  views: [],
  annotations: [],
};

function DemoTable() {
  const adapter = useMemo(() => createLocalStoragePresentationAdapter(), []);
  const [presentation, setPresentation] = useTablePresentationState("sheetbase-demo:table", tableFallback, adapter);
  const theme = useResolvedTheme(presentation.theme);
  const initialData = useMemo(() => new Map<string, string>([
    ["A1", "SMP-2084"], ["B1", "Donor 14"], ["C1", "Plasma"],
    ["A2", "SMP-2087"], ["B2", "Donor 18"], ["C2", "Lysate"],
    ["A3", "SMP-2091"], ["B3", "Donor 22"], ["C3", "Supernatant"],
  ]), []);
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "A1", range: "A1", input: "" });
  return (
    <TableSurface
      theme={theme}
      table={
        <div className="formatted-table">
          <TableFormattingToolbar
            selection={selection.range}
            format={selection.format}
            mixedFormats={selection.mixedFormats}
            onFormat={(format) => tableRef.current?.applyFormat(format)}
            theme={theme}
            themeMode={presentation.theme}
            onThemeChange={(mode) => setPresentation((current) => ({ ...current, theme: mode }))}
          />
          <Spreadsheet
            ref={tableRef}
            initialData={initialData}
            rowCount={12}
            columnCount={tableFields.length}
            fieldIds={tableFields.map((field) => field.id)}
            datasetHeader={{ fields: tableFields }}
            theme={theme}
            onSelectionChange={setSelection}
          />
        </div>
      }
    />
  );
}

const schemaStarter: SchemaGraph = {
  models: [
    {
      name: "customer", label: "Customer",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "name", type: "text" },
        { key: "email", type: "text" },
      ],
    },
    {
      name: "order", label: "Order",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "customer_id", type: "relationship", references: { model: "customer" } },
        { key: "total", type: "number" },
        { key: "status", type: "text" },
      ],
    },
  ],
};

const rulesStarter: PipelineRule[] = [
  parseNaturalLanguageRule("when status is failed then route to review-queue"),
  parseNaturalLanguageRule("reject rows where amount is greater than 5000"),
];

const searchFields = ["status", "amount", "region"];
const searchRows: SearchRow[] = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
];

/** Combined demo (dev only): all five components on one stage, each owning its own theme. */
export function App() {
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
        <RulesEngine value={rules} onChange={setRules} fields={["status", "amount", "region", "email"]} actions={sampleRuleActions} />
      </section>
      <section aria-label="Advanced search">
        <h2>Advanced search</h2>
        <AdvancedSearch fields={searchFields} rows={searchRows} />
      </section>
    </div>
  );
}
