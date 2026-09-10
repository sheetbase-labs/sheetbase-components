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
  { id: "status", label: "status", column: 3, dataType: "text" as const },
  { id: "amount", label: "amount", column: 4, dataType: "number" as const },
];

/** One dataset shared by every pane: table rows, search rows and rules input. */
export const sampleRows = [
  { sample_id: "SMP-2084", donor: "Donor 14", material: "Plasma", status: "failed", amount: 6000 },
  { sample_id: "SMP-2087", donor: "Donor 18", material: "Lysate", status: "ok", amount: 100 },
  { sample_id: "SMP-2091", donor: "Donor 22", material: "Supernatant", status: "blocked", amount: 50 },
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
            onThemeChange={controlledTheme === undefined ? (mode) => {
              setPresentation((current) => ({ ...current, theme: mode }));
              onThemeChange?.(mode);
            } : undefined}
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
      name: "sample", label: "Sample",
      fields: [
        { key: "sample_id", type: "text", primaryKey: true },
        { key: "donor", type: "text" },
        { key: "material", type: "text" },
        { key: "status", type: "text" },
        { key: "amount", type: "number" },
      ],
    },
    {
      name: "donor", label: "Donor",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "name", type: "text" },
      ],
    },
  ],
};

export const rulesStarter: PipelineRule[] = [
  parseNaturalLanguageRule("when status is failed then route to review-queue"),
  parseNaturalLanguageRule("reject rows where amount is greater than 5000"),
];

export const ruleActions = sampleRuleActions;
export const ruleFields = tableFields.map((field) => field.id);

export const searchFields = tableFields.map((field) => field.id);
export const searchRows = sampleRows;

export { Explorer };
