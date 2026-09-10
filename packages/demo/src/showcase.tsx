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
  type ThemeMode,
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

/** The table's data, also handed to the rules engine so rules run over real rows. */
export const sampleRows = [
  { sample_id: "SMP-2084", donor: "Donor 14", material: "Plasma" },
  { sample_id: "SMP-2087", donor: "Donor 18", material: "Lysate" },
  { sample_id: "SMP-2091", donor: "Donor 22", material: "Supernatant" },
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

export function DemoTable({ theme: controlledTheme, onThemeChange, fields = tableFields }: {
  /** Controlled resolved theme. Omit to let the table own its presentation theme. */
  theme?: "light" | "dark";
  onThemeChange?: (mode: ThemeMode) => void;
  /** Dataset header to show. Defaults to the built-in sample fields. */
  fields?: ReadonlyArray<{ id: string; label: string; column: number; dataType: "text" | "number" | "boolean" | "date" | "relationship" }>;
} = {}) {
  const adapter = useMemo(() => createLocalStoragePresentationAdapter(), []);
  const [presentation, setPresentation] = useTablePresentationState("sheetbase-demo:table", tableFallback, adapter);
  const resolvedTheme = useResolvedTheme(presentation.theme);
  const theme = controlledTheme ?? resolvedTheme;
  const initialData = useMemo(() => {
    const map = new Map<string, string>();
    sampleRows.forEach((row, r) => {
      tableFields.forEach((field, c) => {
        map.set(`${String.fromCharCode(65 + c)}${r + 1}`, String(row[field.id as keyof typeof row] ?? ""));
      });
    });
    return map;
  }, []);
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
            themeMode={controlledTheme ?? presentation.theme}
            onThemeChange={(mode) => {
              if (controlledTheme === undefined) setPresentation((current) => ({ ...current, theme: mode }));
              onThemeChange?.(mode);
            }}
          />
          <Spreadsheet
            ref={tableRef}
            initialData={initialData}
            rowCount={12}
            columnCount={fields.length}
            fieldIds={fields.map((field) => field.id)}
            datasetHeader={{ fields }}
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
  parseNaturalLanguageRule("when material is Plasma then route to plasma-queue"),
  parseNaturalLanguageRule("reject rows where donor is Donor 22"),
];

export const ruleActions = sampleRuleActions;
export const ruleFields = ["sample_id", "donor", "material"];

export const searchFields = ["status", "amount", "region"];
export const searchRows: SearchRow[] = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
];

export { Explorer };
