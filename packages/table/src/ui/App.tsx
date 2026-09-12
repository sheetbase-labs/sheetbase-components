import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { columnLabel } from "../engine/coordinates";
import type { Dataset } from "../engine/types";
import type { DatasetQuery } from "../data";
import { Spreadsheet, type SpreadsheetHandle, type SpreadsheetSelection, type SpreadsheetState } from "./Spreadsheet";
import { FormulaBar, SheetBar, TableLayout, minimalTableSections } from "./TableSections";
import { TableWorkbook } from "./TableWorkbook";
import { renameSheetReferences } from "../grid/model";
import { PagedDemo } from "./PagedDemo";
import { FunctionsDemo, DEMO_SECTIONS } from "./FunctionsDemo";
import { TableSurface } from "./TableSurface";
import { useResolvedTheme } from "./presentation-state";

const dataset: Dataset = {
  id: "experiments",
  label: "Experiments",
  sourceLabel: "Postgres",
  rowCount: 2_480_512,
  fields: [
    { id: "experiment_id", label: "experiment_id", dataType: "text", writable: false },
    { id: "sample_id", label: "sample_id", dataType: "text", writable: true },
    { id: "assay", label: "assay", dataType: "text", writable: true },
    { id: "result", label: "result", dataType: "number", writable: true },
    { id: "unit", label: "unit", dataType: "text", writable: true },
    { id: "run_date", label: "run_date", dataType: "date", writable: true },
    { id: "status", label: "status", dataType: "text", writable: true },
  ],
};

const rows = [
  ["EXP-1048", "SMP-2084", "p24 ELISA", "18.42", "ng/mL", "2026-08-28", "Complete"],
  ["EXP-1049", "SMP-2087", "Residual DNA", "0.034", "ng/dose", "2026-08-28", "Complete"],
  ["EXP-1050", "SMP-2091", "Vector ID", "29.18", "Ct", "2026-08-29", "Review"],
  ["EXP-1051", "SMP-2096", "BCA", "1.72", "mg/mL", "2026-08-30", "Complete"],
  ["EXP-1052", "SMP-2102", "HCP", "8.91", "ng/mL", "2026-08-30", "Flagged"],
  ["EXP-1053", "SMP-2107", "PicoGreen", "12.04", "ng/mL", "2026-08-31", "Complete"],
  ["EXP-1054", "SMP-2110", "Benzonase", "0.18", "ng/mL", "2026-08-31", "Review"],
  ["EXP-1055", "SMP-2114", "p24 ELISA", "21.09", "ng/mL", "2026-09-01", "Complete"],
];

const extraFields = ["reviewer", "batch_id", "method_version", "instrument", "created_by", "modified_at", "notes", "approved", "record_id", "source"];
type DemoSheetState = { initialData: ReadonlyMap<string, string>; spreadsheet?: SpreadsheetState; query: DatasetQuery };

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(window.location.search);
  if (search.has("paged")) {
    // Legacy `?paged=1` deep link; the canonical route is now `/million`.
    search.delete("paged");
    const rest = search.toString();
    window.history.replaceState(null, "", `/million${rest ? `?${rest}` : ""}`);
    return <DemoPage current="million"><PagedDemo /></DemoPage>;
  }
  if (path === "/million") return <DemoPage current="million"><PagedDemo /></DemoPage>;
  if (path === "/bare") return <DemoPage current="bare"><BareTable /></DemoPage>;
  if (path === "/default") return <DemoPage current="default"><DefaultTable /></DemoPage>;
  if (path === "/readonly") return <DemoPage current="readonly"><DefaultTable readOnly /></DemoPage>;
  if (path === "/functions") return <DemoPage current="functions"><FunctionsTable /></DemoPage>;
  return <Home />;
}

function DemoNav({ current }: { current: string }) {
  return <nav className="demo-nav" aria-label="Demos">
    <a href="/" aria-current={current === "home" ? "page" : undefined}>Sheetbase Table</a>
    <span className="demo-nav-links">
      <a href="/bare" aria-current={current === "bare" ? "page" : undefined}>Bare</a>
      <a href="/default" aria-current={current === "default" ? "page" : undefined}>Default</a>
      <a href="/readonly" aria-current={current === "readonly" ? "page" : undefined}>Read-only</a>
      <a href="/million" aria-current={current === "million" ? "page" : undefined}>Million-row</a>
      <a href="/functions" aria-current={current === "functions" ? "page" : undefined}>Functions</a>
    </span>
  </nav>;
}

function DemoPage({ current, children }: { current: string; children: ReactNode }) {
  return <main className="stage demo-page">
    <DemoNav current={current} />
    {children}
  </main>;
}
function Home() {
  const theme = useResolvedTheme("system");
  return <main className="stage demo-home-live">
    <DemoNav current="home" />
    <header className="demo-home-head">
      <h1>Sheetbase Table</h1>
      <p>Three live table compositions over the same grid engine, plus a live gallery of every supported function. Pick the chrome you need; the engine stays unchanged.</p>
    </header>
    <section className="demo-section" aria-label="Bare bones table">
      <div className="demo-section-head">
        <h2>Bare bones</h2>
        <a href="/bare">Open full page</a>
      </div>
      <p>Raw <code>Spreadsheet</code> only — no formula bar, sheet tabs, toolbar, or dataset header. For hosts that bring their own chrome.</p>
      <BareTable />
    </section>
    <section className="demo-section" aria-label="Default table">
      <div className="demo-section-head">
        <h2>Default</h2>
        <a href="/default">Open full page</a>
      </div>
      <p><code>TableLayout</code> with formula bar and sheet tabs, a typed dataset header (10k rows, computed column, query), plain text cells.</p>
      <DefaultTable />
    </section>
    <section className="demo-section" aria-label="Fully featured table">
      <div className="demo-section-head">
        <h2>Fully featured</h2>
        <a href="/million">Open full page</a>
      </div>
      <p>One million paged rows via <code>/api/table</code> on a <code>TableSurface</code>: formatting toolbar with the dark/light toggle (◐/☀), filters, column manager, conditional-formatting inspector, persisted presentation. Needs <code>bun run dev:api</code>.</p>
      <PagedDemo />
    </section>
    <section className="demo-section" aria-label="Supported functions">
      <div className="demo-section-head">
        <h2>Functions</h2>
        <a href="/functions">Open full page</a>
      </div>
      <p>A live workbook of every vendored function — one tab per category, column B calculates on the real engine. The reference gallery below evaluates the same entries at render time.</p>
      <FunctionsDemo theme={theme} />
    </section>
  </main>;
}

/** Smallest useful composition: the grid engine with no table chrome. */
function scalarInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** One workbook tab per function category: column A names it, column B calculates it live. */
function FunctionsTable() {
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "B8", range: "B8", input: "" });
  const [formula, setFormula] = useState("");
  const [, renderWorkbook] = useState(0);
  const focusTable = () => tableRef.current?.focus();
  const workbookRef = useRef<TableWorkbook<DemoSheetState> | null>(null);
  if (!workbookRef.current) {
    workbookRef.current = new TableWorkbook<DemoSheetState>(
      DEMO_SECTIONS.map((section) => {
        const data = new Map<string, string>();
        for (const entry of section.entries) {
          for (const [address, value] of Object.entries(entry.cells)) data.set(address, scalarInput(value));
        }
        data.set("A7", "Function");
        data.set("B7", "Live formula — edit me");
        section.entries.forEach((entry, index) => {
          const row = 8 + index * 5;
          data.set(`A${row}`, entry.fn);
          data.set(`B${row}`, entry.formula);
        });
        return {
          id: section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          label: section.title,
          kind: "sheet" as const,
          state: { initialData: data, query: {} },
        };
      }),
    );
  }
  const workbook = workbookRef.current;
  const activeSheet = workbook.activeSheet;
  const onSelectionChange = useCallback((next: SpreadsheetSelection) => {
    setSelection(next);
    setFormula(next.input);
  }, []);
  const saveActiveSheet = () => {
    workbook.update(workbook.activeSheetId, (state) => ({ ...state, spreadsheet: tableRef.current?.snapshot() ?? state.spreadsheet }));
  };
  const selectSheet = (sheetId: string) => {
    saveActiveSheet();
    workbook.select(sheetId);
    setSelection({ address: "B8", range: "B8", input: "" });
    setFormula("");
    renderWorkbook((version) => version + 1);
  };
  const theme = useResolvedTheme("system");
  return <TableSurface
    theme={theme}
    table={<TableLayout
    sections={minimalTableSections}
    theme={theme}
    formulaBar={<FormulaBar
      address={selection.range}
      value={formula}
      onChange={(value) => { setFormula(value); tableRef.current?.editActiveInput(value); }}
      onCommit={() => { tableRef.current?.commitEdit(); focusTable(); }}
      onCancel={() => { tableRef.current?.cancelEdit(); setFormula(selection.input); focusTable(); }}
      error={selection.error}
    />}
    table={<Spreadsheet
      key={activeSheet.id}
      ref={tableRef}
      initialData={activeSheet.state.initialData}
      initialState={activeSheet.state.spreadsheet}
      rowCount={400}
      columnCount={6}
      onSelectionChange={onSelectionChange}
      onEditChange={setFormula}
    />}
    sheetBar={<SheetBar
      sheets={workbook.tabs}
      activeSheetId={activeSheet.id}
      onSelect={selectSheet}
    />}
  />}
  />;
}

function BareTable() {
  const initialData = useMemo(() => new Map<string, string>([
    ["A1", "SMP-2084"], ["B1", "Donor 14"], ["C1", "Plasma"],
    ["A2", "SMP-2087"], ["B2", "Donor 18"], ["C2", "Lysate"],
    ["A3", "SMP-2091"], ["B3", "Donor 22"], ["C3", "Supernatant"],
  ]), []);
  const theme = useResolvedTheme("system");
  return <TableSurface
    theme={theme}
    frame={false}
    table={<TableLayout
      sections={{ menuBar: false, toolbar: false, formulaBar: false, sidebar: false, statusBar: false, sheetBar: false }}
      theme={theme}
      table={<Spreadsheet initialData={initialData} rowCount={50} columnCount={5} theme={theme} />}
    />}
  />;
}

function DefaultTable({ readOnly = false }: { readOnly?: boolean }) {
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "C6", range: "C6", input: "HCP" });
  const [formula, setFormula] = useState("HCP");
  const [, renderWorkbook] = useState(0);
  const allColumns = useMemo(() => [...dataset.fields.map((field) => field.label), ...extraFields], []);
  const initialData = useMemo(() => {
    const data = new Map<string, string>();
    rows.forEach((row, rowIndex) => {
      row.forEach((value, column) => {
        data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
      });
    });
    return data;
  }, []);
  const workbookRef = useRef<TableWorkbook<DemoSheetState> | null>(null);
  if (!workbookRef.current) {
    const sampleData = new Map<string, string>([
      ["A1", "SMP-2084"], ["B1", "Donor 14"], ["C1", "Plasma"],
      ["A2", "SMP-2087"], ["B2", "Donor 18"], ["C2", "Lysate"],
      ["A3", "SMP-2091"], ["B3", "Donor 22"], ["C3", "Supernatant"],
    ]);
    workbookRef.current = new TableWorkbook<DemoSheetState>([
      { id: "experiments", label: "Experiments", kind: "dataset", state: { initialData, query: {} } },
      { id: "samples", label: "Samples", kind: "dataset", state: { initialData: sampleData, query: {} } },
    ]);
  }
  const workbook = workbookRef.current;
  const activeSheet = workbook.activeSheet;
  const onSelectionChange = useCallback((next: SpreadsheetSelection) => {
    setSelection(next);
    setFormula(next.input);
  }, []);
  const focusTable = () => tableRef.current?.focus();
  const saveActiveSheet = () => {
    workbook.update(workbook.activeSheetId, (state) => ({ ...state, spreadsheet: tableRef.current?.snapshot() ?? state.spreadsheet }));
  };
  const selectSheet = (sheetId: string) => {
    saveActiveSheet();
    workbook.select(sheetId);
    const next = workbook.activeSheet.state.spreadsheet;
    const nextSelection = next?.selection;
    const address = nextSelection ? `${columnLabel(nextSelection.focus.column)}${nextSelection.focus.row + 1}` : "A1";
    const input = next?.data.get(address) ?? workbook.activeSheet.state.initialData.get(address) ?? "";
    setSelection({ address, range: address, input });
    setFormula(input);
    renderWorkbook((version) => version + 1);
  };
  const addSheet = () => {
    saveActiveSheet();
    const number = workbook.sheets.length + 1;
    workbook.add({ id: `sheet-${Date.now()}`, label: `Sheet ${number}`, kind: "sheet", state: { initialData: new Map(), query: {} } });
    setSelection({ address: "A1", range: "A1", input: "" });
    setFormula("");
    renderWorkbook((version) => version + 1);
  };
  const renameSheet = (sheetId: string, label: string) => {
    saveActiveSheet();
    const previous = workbook.sheets.find((sheet) => sheet.id === sheetId)?.label;
    if (!previous) return;
    for (const sheet of workbook.sheets) workbook.update(sheet.id, (state) => {
      const source = state.spreadsheet?.data ?? state.initialData;
      const data = new Map([...source].map(([address, input]) => [address, renameSheetReferences(input, previous, label)]));
      return { ...state, initialData: data, spreadsheet: state.spreadsheet ? { ...state.spreadsheet, data } : undefined };
    });
    workbook.rename(sheetId, label);
    renderWorkbook((version) => version + 1);
  };
  const deleteSheet = (sheetId: string) => {
    saveActiveSheet();
    const target = workbook.sheets.find((sheet) => sheet.id === sheetId);
    if (!target) return;
    const quoted = `'${target.label.replace(/'/g, "''")}'!`;
    const referenced = workbook.sheets.some((sheet) => sheet.id !== sheetId && [...(sheet.state.spreadsheet?.data ?? sheet.state.initialData).values()].some((input) => input.startsWith("=") && (input.includes(`${target.label}!`) || input.includes(quoted))));
    if (referenced && !window.confirm(`Delete ${target.label}? Formulas on other sheets refer to it.`)) return;
    workbook.remove(sheetId);
    const next = workbook.activeSheet.state.spreadsheet;
    const address = next ? `${columnLabel(next.selection.focus.column)}${next.selection.focus.row + 1}` : "A1";
    const input = next?.data.get(address) ?? workbook.activeSheet.state.initialData.get(address) ?? "";
    setSelection({ address, range: address, input });
    setFormula(input);
    renderWorkbook((version) => version + 1);
  };

  const theme = useResolvedTheme("system");
  return <TableSurface
    theme={theme}
    table={<TableLayout
    sections={minimalTableSections}
    theme={theme}
    formulaBar={<FormulaBar
      address={selection.range}
      value={formula}
      readOnly={readOnly}
      onChange={(value) => { if (readOnly) return; setFormula(value); tableRef.current?.editActiveInput(value); }}
      onCommit={() => { if (!readOnly) tableRef.current?.commitEdit(); focusTable(); }}
      onCancel={() => { tableRef.current?.cancelEdit(); setFormula(selection.input); focusTable(); }}
      error={selection.error}
    />}
    table={<Spreadsheet
      key={activeSheet.id}
      ref={tableRef}
      readOnly={readOnly}
      initialData={activeSheet.state.initialData}
      initialState={activeSheet.state.spreadsheet}
      rowCount={10_000}
      columnCount={allColumns.length}
      fieldColumns={new Set(allColumns.map((_, index) => index))}
      computedColumns={new Set([3])}
      datasetHeader={{
        datasetId: dataset.id,
        recordIdForRow: (row) => rows[row]?.[0],
        fields: allColumns.map((label, column) => ({
          id: dataset.fields[column]?.id ?? label,
          label,
          column,
          writable: dataset.fields[column]?.writable ?? true,
          computed: column === 3,
          dataType: label === "approved" ? "boolean" : label === "reviewer" ? "relationship" : dataset.fields[column]?.dataType === "number" ? "number" : dataset.fields[column]?.dataType === "date" ? "date" : "text",
          options: label === "status" ? ["Complete", "Review", "Flagged"] : label === "reviewer" ? ["Alice Chen", "David Okafor", "Maya Singh"] : undefined,
        })),
      }}
      onSelectionChange={onSelectionChange}
      onEditChange={setFormula}
      fieldIds={[...dataset.fields.map((field) => field.id), ...extraFields]}
      query={activeSheet.state.query}
      onQueryChange={(query) => {
        workbook.update(activeSheet.id, (state) => ({ ...state, query }));
        renderWorkbook((version) => version + 1);
      }}
      contextMenuActions={[{ label: "Copy column name", onSelect: ({ fieldId }) => fieldId && navigator.clipboard?.writeText(fieldId).catch(() => {}) }]}
    />}
    sheetBar={<SheetBar
      sheets={workbook.tabs}
      activeSheetId={activeSheet.id}
      onSelect={selectSheet}
      onAdd={readOnly ? undefined : addSheet}
      onRename={readOnly ? undefined : renameSheet}
      onDelete={readOnly ? undefined : deleteSheet}
      onMove={readOnly ? undefined : (sheetId, index) => { workbook.move(sheetId, index); renderWorkbook((version) => version + 1); }}
    />}
  />}
  />;
}
