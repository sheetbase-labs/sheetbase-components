/**
 * COMP-02.6 visual fixture: the NbOffline notebook block grid ("Clarification
 * runs", clarification: depth filter screening, seen while offline).
 *
 * Crop box (NbOffline renders, 1440×1000, scale 1): x=264 y=260 w=839 h=197 —
 * the grid wrapper's border box (the `.g` table is 265,261 843×196, clipped 4px
 * on the right). The grid is a window into the run list: the first visible run
 * is 4, so the data sits at grid rows 4–9 and the viewport is scrolled past the
 * three rows above it.
 *
 * Columns, widths, alignment, states and rows come from `canvas/NbOffline.dc.html`
 * and the live DOM of `NbOffline-light.png`. Run 6 carries a local edit — its
 * Capsid titre is unsynced (dotted underline + dot badge) and its Step yield is
 * the muted "(local)" value; run 9 Turbidity 61.5 is invalid (danger wash). The
 * design shows no active cell, so the fixture parks the selection off-screen.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

/** Extra CSS the v3 preset does not express: the design's right-aligned numeric
 *  headers, its unselected header paint and its 400-weight chrome. */
const fixtureCss = `
.sheetbase-scope.spreadsheet .column-header { gap: 4px; }
.sheetbase-scope.spreadsheet .column-header .fx { line-height: 12px; }
.sheetbase-scope.spreadsheet .column-header.selected-header {
  font-weight: 500;
  background: var(--grid-header-surface);
  color: var(--grid-column-header-ink);
}
.sheetbase-scope.spreadsheet .grid-cell.cell-invalid { font-weight: 400; }
.sheetbase-scope.spreadsheet .grid-cell.cell-unsynced::after { background: var(--palette-muted-3); }
.sheetbase-scope.spreadsheet .row-header,
.sheetbase-scope.spreadsheet .row-header.selected-header { font-weight: 400; }
.sheetbase-scope.spreadsheet .column-header[aria-label^="C "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="D "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="E "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="F "] { justify-content: flex-end; }
`;

type Header = readonly [id: string, label: string, computed: boolean];

const headers: readonly Header[] = [
  ["condition", "Condition", false],
  ["filter_train", "Filter train", false],
  ["load", "Load (L/m²)", false],
  ["turbidity", "Turbidity out (NTU)", false],
  ["capsid_titre", "Capsid titre (cp/mL)", false],
  ["step_yield", "Step yield (%)", true],
  ["meets_criteria", "Meets criteria", true],
];

const rowHeaderWidth = 36;
const widths = [76.859, 105.453, 90.641, 136.391, 139.953, 130.078, 127.625];

// The design's first visible run is 4; the grid is a page into the full run
// list, so the data lives at absolute rows 4–9 (1-indexed).
const firstRun = 4;
const rows: readonly (readonly string[])[] = [
  ["B-50", "MAT-0419 B", "50", "4.1", "7.8 × 10¹¹", "90.7", "Yes"],
  ["B-100", "MAT-0419 B", "100", "5.6", "7.6 × 10¹¹", "88.4", "Yes"],
  // Run 6 carries a local edit: its Capsid titre is unsynced (dotted underline
  // + dot badge) and its Step yield is the muted "(local)" value.
  ["B-150", "MAT-0419 B", "150", "8.9", "7.4 × 10¹¹", "86.0 (local)", "Yes"],
  ["C-50", "MAT-0420 C", "50", "12.7", "6.9 × 10¹¹", "80.2", "Yes"],
  ["C-100", "MAT-0420 C", "100", "24.3", "6.2 × 10¹¹", "72.1", "No · both"],
  ["C-150", "MAT-0420 C", "150", "61.5", "5.4 × 10¹¹", "62.8", "No · both"],
];

const data = new Map<string, string>();
rows.forEach((row, offset) => {
  const rowNumber = firstRun + offset;
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowNumber}`, value);
  });
});

// Numeric columns right-align (`.r` on every data cell).
const formats = new RangeStore<CellFormat>();
for (const column of [2, 3, 4, 5]) {
  formats.write({ start: { row: firstRun - 1, column }, end: { row: firstRun + rows.length - 1, column } }, { horizontalAlign: "right" });
}

const totalRows = firstRun + rows.length; // 10: rows 1–3 empty, then 4–9
const scrollTop = (firstRun - 1) * 28;
// Run 6 (grid index 5, absolute row 6) carries the unsynced local edit.
const unsyncedRow = firstRun + 2;

const render = (theme: "light" | "dark") => (
  <>
    <style>{fixtureCss}</style>
    <div className="sheetbase-scope" data-theme={theme} style={{ width: 839, height: 197, background: "var(--surface)" }}>
    <Spreadsheet
      theme={theme}
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights: Array.from({ length: totalRows }, () => 28),
        // The design shows no active cell; park the selection on the scrolled-out
        // A1 so nothing paints.
        selection: { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
        scroll: { top: scrollTop, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={totalRows}
      columnCount={headers.length}
      headerHeight={28}
      defaultRowHeight={28}
      rowHeaderWidth={rowHeaderWidth}
      fieldColumns={new Set(headers.map((_, index) => index))}
      computedColumns={new Set([5, 6])}
      datasetHeader={{
        datasetId: "clarification-runs",
        recordIdForRow: (row) => rows[row - firstRun]?.[0],
        fields: headers.map(([id, label, computed], column) => ({
          id,
          label,
          column,
          computed,
          writable: false,
        })),
      }}
      // Run 6's Capsid titre is the unsynced local edit (dotted underline + dot);
      // run 9's Turbidity 61.5 is the invalid reading (danger wash).
      cellState={(row, column) => {
        if (row === unsyncedRow - 1 && column === 4) return "unsynced";
        if (row === firstRun + rows.length - 2 && column === 3) return "invalid";
        return undefined;
      }}
      // Run 6's Step yield is the muted "(local)" value.
      renderCell={({ point, display }) => point.row === unsyncedRow - 1 && point.column === 5
        ? <span style={{ color: "var(--muted)" }}>{display.replace(" (local)", "")} <span style={{ fontSize: 11 }}>(local)</span></span>
        : undefined}
    />
    </div>
  </>
);

export default { width: 839, height: 197, render } satisfies V3FixtureModule;
