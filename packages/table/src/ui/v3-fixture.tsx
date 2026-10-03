/**
 * COMP-02.6 visual fixture: the SheetWorking grid, rendered from the design's
 * own nine conditions under `themes/v3.css` at the design's grid box
 * (855×293), for comparison with a crop of the ELN design render.
 *
 * Columns, header labels, sources, widths and states come from
 * `canvas/SheetWorking.dc.html` / `SheetWorking-light.png`.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";
import "./styles.css";
import { Spreadsheet, type DatasetFieldHeader, type SpreadsheetState } from "./Spreadsheet";
import { RangeStore } from "../engine/range-store";
import type { CellFormat } from "../engine/types";

type Header = readonly [id: string, label: string, source: DatasetFieldHeader["source"], sourceLabel: string, writable: boolean];

const headers: readonly Header[] = [
  ["condition", "Condition", "dataset", "DS-0311 · S-15", false],
  ["filter_train", "Filter train", "record", "Material record", false],
  ["load", "Load (L/m²)", "dataset", "DS-0311 · S-15", false],
  ["turbidity", "Turbidity (NTU)", "dataset", "DS-0311 · S-15", false],
  ["capsid_titre", "Capsid titre (cp/mL)", "dataset", "DS-0311 · S-15", false],
  ["step_yield", "Step yield (%)", "calc", "", false],
  ["visual_clarity", "Visual clarity", "local", "Local", true],
  ["adj_yield", "Adj. yield (%)", "local", "Local", true],
];

const widths = [107, 103, 108, 107, 133, 99, 91, 82];

const rows: readonly (readonly string[])[] = [
  ["A-50", "MAT-0418 A", "50", "6.2", "7.4 × 10¹¹", "86.0", "Clear", "85"],
  ["A-100", "MAT-0418 A", "100", "9.8", "7.1 × 10¹¹", "82.6", "Clear", "82"],
  ["A-150", "MAT-0418 A", "150", "18.4", "6.5 × 10¹¹", "75.6", "Slight haze", "—"],
  ["B-50", "MAT-0419 B", "50", "4.1", "7.8 × 10¹¹", "90.7", "Clear", "90"],
  ["B-100", "MAT-0419 B", "100", "5.6", "7.6 × 10¹¹", "88.4", "Clear", "88"],
  ["B-150", "MAT-0419 B", "150", "8.9", "7.3 × 10¹¹", "84.9", "Clear", "84"],
  ["C-50", "MAT-0420 C", "50", "12.7", "6.9 × 10¹¹", "80.2", "Slight haze", "79"],
  ["C-100", "MAT-0420 C", "100", "24.3", "6.2 × 10¹¹", "72.1", "Hazy", "—"],
  ["C-150", "MAT-0420 C", "150", "61.5", "5.4 × 10¹¹", "62.8", "Hazy", "—"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

const initialState: SpreadsheetState = {
  data,
  formats: new RangeStore<CellFormat>(),
  columnWidths: widths,
  rowHeights: rows.map(() => 28),
  // The design's active cell is Visual clarity · A-150 (row 3, column G).
  selection: { anchor: { row: 2, column: 6 }, focus: { row: 2, column: 6 } },
  scroll: { top: 0, left: 0 },
  frozenRows: 0,
  frozenColumns: 0,
};

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div id="grid-fixture">
      <Spreadsheet
        theme={theme}
        readOnly
        initialData={data}
        initialState={initialState}
        rowCount={rows.length}
        columnCount={headers.length}
        headerHeight={40}
        defaultRowHeight={28}
        rowHeaderWidth={25}
        fieldColumns={new Set(headers.map((_, index) => index))}
        computedColumns={new Set([5])}
        datasetHeader={{
          datasetId: "sheet-working",
          recordIdForRow: (row) => rows[row]?.[0],
          fields: headers.map(([id, label, source, sourceLabel, writable], column) => ({
            id,
            label,
            column,
            source,
            sourceLabel: sourceLabel || undefined,
            writable,
          })),
        }}
        // The design's C-150 turbidity is the invalid cell (danger wash).
        cellState={(row, column) => (row === 8 && column === 3 ? "invalid" : undefined)}
      />
    </div>
  </React.StrictMode>,
);
