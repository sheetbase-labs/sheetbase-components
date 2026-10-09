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
} from "@sheetbase-labs/sheetbase-table";
import { App as Explorer, type Dataset } from "@sheetbase-labs/sheetbase-explorer";
import { parseNaturalLanguageRule, sampleRuleActions, type PipelineRule } from "@sheetbase-labs/sheetbase-rulesengine";
import type { SchemaGraph } from "@sheetbase-labs/sheetbase-schemaeditor";

/** Shared demo fixtures + table factory used by both the workbench and the stacked page. */

export const tableFields = [
  { id: "sample_id", label: "sample_id", column: 0, dataType: "text" as const },
  { id: "donor", label: "donor", column: 1, dataType: "text" as const },
  { id: "material", label: "material", column: 2, dataType: "text" as const },
  { id: "status", label: "status", column: 3, dataType: "text" as const },
  { id: "batch", label: "batch", column: 4, dataType: "text" as const },
  { id: "collected_on", label: "collected_on", column: 5, dataType: "date" as const },
  { id: "amount", label: "amount", column: 6, dataType: "number" as const },
];

export type SampleRow = {
  sample_id: string;
  donor: string;
  material: string;
  status: string;
  batch: string;
  collected_on: string;
  amount: number;
};

const MATERIALS = ["Plasma", "Lysate", "Supernatant", "Serum", "Cells"];
const STATUSES = ["ok", "failed", "blocked", "pending"];
const BATCHES = Array.from({ length: 12 }, (_, index) => `B-${String(index + 1).padStart(2, "0")}`);
/** Amount correlates with material and status so the demo chart has a shape. */
const MATERIAL_BASE: Record<string, number> = { Plasma: 5200, Lysate: 3100, Supernatant: 1800, Serum: 4200, Cells: 900 };
const STATUS_FACTOR: Record<string, number> = { ok: 1, failed: 1.35, blocked: 0.9, pending: 1.05 };

/** Small deterministic PRNG so the demo data is stable across reloads and tests. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRows(count: number): SampleRow[] {
  const rows: SampleRow[] = [
    { sample_id: "SMP-2084", donor: "Donor 14", material: "Plasma", status: "failed", batch: "B-03", collected_on: "2025-02-11", amount: 6000 },
    { sample_id: "SMP-2087", donor: "Donor 18", material: "Lysate", status: "ok", batch: "B-05", collected_on: "2025-02-14", amount: 100 },
    { sample_id: "SMP-2091", donor: "Donor 22", material: "Supernatant", status: "blocked", batch: "B-07", collected_on: "2025-02-19", amount: 50 },
  ];
  const random = mulberry32(20240910);
  const start = new Date("2025-01-06").getTime();
  const day = 86_400_000;
  for (let index = 0; rows.length < count; index += 1) {
    const material = MATERIALS[Math.floor(random() * MATERIALS.length)];
    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    rows.push({
      sample_id: `SMP-${3001 + index}`,
      donor: `Donor ${1 + Math.floor(random() * 24)}`,
      material,
      status,
      batch: BATCHES[Math.floor(random() * BATCHES.length)],
      collected_on: new Date(start + Math.floor(random() * 240) * day).toISOString().slice(0, 10),
      amount: Math.round(MATERIAL_BASE[material] * STATUS_FACTOR[status] * (0.85 + random() * 0.3)) + 25,
    });
  }
  return rows;
}

/** One dataset shared by every pane: table rows, search rows and rules input. */
export const sampleRows: SampleRow[] = generateRows(1500);

/**
 * Field descriptor for the example API's `experiments` dataset — the remote
 * workbench source. Columns mirror `generated()` in
 * `packages/table/examples/million-row-api.ts`.
 */
export const experimentFields = [
  { id: "experiment_id", label: "experiment_id", column: 0, dataType: "text" as const },
  { id: "sample_id", label: "sample_id", column: 1, dataType: "text" as const },
  { id: "assay", label: "assay", column: 2, dataType: "text" as const },
  { id: "result", label: "result", column: 3, dataType: "number" as const },
  { id: "unit", label: "unit", column: 4, dataType: "text" as const },
  { id: "run_date", label: "run_date", column: 5, dataType: "date" as const },
  { id: "status", label: "status", column: 6, dataType: "text" as const },
  { id: "reviewer", label: "reviewer", column: 7, dataType: "text" as const },
  { id: "approved", label: "approved", column: 8, dataType: "boolean" as const },
];

const tableFallback: TablePresentationState = {
  version: 3,
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
        { key: "batch", type: "text" },
        { key: "collected_on", type: "date" },
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

/**
 * Wrap rows the explorer can chart. Columns come from the shared field contract
 * (the schema selection that also feeds the table and search), with cardinality
 * measured against the full sample so grouping choices stay stable.
 */
export function createExplorerDataset(
  rows: readonly Record<string, unknown>[],
  fields: readonly { id: string; label: string; dataType: string }[] = tableFields,
): Dataset {
  const columns = fields.map((field) => {
    const kind = field.dataType === "number" ? "number" as const
      : field.dataType === "boolean" ? "boolean" as const
        : field.dataType === "date" || field.dataType === "datetime" ? "date" as const
          : "string" as const;
    const values = sampleRows.map((row) => row[field.id as keyof SampleRow]);
    return {
      key: field.id,
      kind,
      nullable: values.some((value) => value === null || value === undefined || value === ""),
      uniqueCount: new Set(values.map((value) => String(value))).size,
    };
  });
  return { name: "samples", source: "Workspace", columns, rows: rows as Record<string, unknown>[] };
}

/** Build a schema graph from table fields, so the schema can reflect the table. */
export function schemaFromFields(
  fields: readonly { id: string; label: string; dataType: string }[],
  name = "sample",
  label = "Sample",
): SchemaGraph {
  return {
    models: [{
      name,
      label,
      fields: fields.map((field) => ({ key: field.id, label: field.label, type: field.dataType as SchemaGraph["models"][number]["fields"][number]["type"] })),
    }],
  };
}

export { Explorer };