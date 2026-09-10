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
import { parseNaturalLanguageRule, sampleRuleActions, type PipelineRule } from "sheetbase-rulesengine";
import type { SchemaGraph } from "sheetbase-schemaeditor";
import type { SearchRow } from "sheetbase-advanced-search";

/** Shared demo fixtures + table factory used by both the workbench and the stacked page. */

export const tableFields = [
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

export function DemoTable() {
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

export const schemaStarter: SchemaGraph = {
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

export const rulesStarter: PipelineRule[] = [
  parseNaturalLanguageRule("when status is failed then route to review-queue"),
  parseNaturalLanguageRule("reject rows where amount is greater than 5000"),
];

export const ruleActions = sampleRuleActions;
export const ruleFields = ["status", "amount", "region", "email"];

export const searchFields = ["status", "amount", "region"];
export const searchRows: SearchRow[] = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
];

export { Explorer };
