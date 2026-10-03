/**
 * COMP-02.6 visual fixture: the NbEditing notebook block grid ("Clarification
 * runs", clarification: depth filter screening).
 *
 * Crop box (NbEditing renders, 1440×1100, scale 1): x=264 y=247 w=844 h=141 —
 * the grid wrapper's border box (the `.g` table is 265,248 843×140). The grid
 * is a window into the run list: the first visible run is 7, so the data sits
 * at grid rows 7–9 and the viewport is scrolled past the six rows above it.
 *
 * Columns, widths, states and rows come from `canvas/NbEditing.dc.html` and
 * the live DOM of `NbEditing-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

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

const rowHeaderWidth = 38.42;
const widths = [72.78, 94.42, 132.05, 129.17, 132.55, 122.95, 120.66];

// The design's first visible run is 7; the grid is a page into the full run
// list, so the data lives at absolute rows 7–9 (1-indexed).
const firstRun = 7;
const rows: readonly (readonly string[])[] = [
  ["C-50", "MAT-0420 C", "50", "12.7", "6.9 × 10¹¹", "80.2", "Yes"],
  ["C-100", "MAT-0420 C", "100", "24.3", "6.2 × 10¹¹", "72.1", "No · both"],
  ["C-150", "MAT-0420 C", "150", "61.5", "5.4 × 10¹¹", "62.8", "No · both"],
  // The design's unsaved draft run (grid row 10): the new values are typed but
  // the row is not committed, so the design paints its row number as "new".
  ["C-150R", "MAT-0420 C", "15", "—", "—", "—", "—"],
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

const totalRows = firstRun + rows.length; // 10: rows 1–6 empty, then 7–9
const scrollTop = (firstRun - 1) * 28;

// The design right-aligns the numeric headers and paints the unsaved draft row
// with `--selection-subtle` (a distinct dark surface), while the load cell
// being edited keeps the `--surface` fill. The grid exposes neither as a prop,
// so apply the design presentation here.
const designCss = `
#grid-fixture { background: var(--surface); }
#grid-fixture .spreadsheet .column-header[aria-label^="C "],
#grid-fixture .spreadsheet .column-header[aria-label^="D "],
#grid-fixture .spreadsheet .column-header[aria-label^="E "],
#grid-fixture .spreadsheet .column-header[aria-label^="F "] { justify-content: flex-end; }
#grid-fixture .spreadsheet .grid-cell[aria-rowindex="10"] { background: var(--selection-subtle); }
#grid-fixture .spreadsheet .grid-cell[aria-rowindex="10"][aria-colindex="3"] { background: var(--surface); }
#grid-fixture .spreadsheet .row-header[aria-label="10"] {
  background: var(--selection);
  color: var(--text);
  font-size: 11px;
}
`;

const render = (theme: "light" | "dark") => (
  <>
    <style>{designCss}</style>
    <Spreadsheet
    theme={theme}
    initialData={data}
    initialState={{
      data,
      formats,
      columnWidths: widths,
      rowHeights: Array.from({ length: totalRows }, () => 28),
      // The design's active cell is the draft run's Load cell (grid row 10).
      selection: { anchor: { row: firstRun + rows.length - 2, column: 2 }, focus: { row: firstRun + rows.length - 2, column: 2 } },
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
    // The design's C-150 turbidity is the invalid cell (danger wash).
    cellState={(row, column) => (row === firstRun + 1 && column === 3 ? "invalid" : undefined)}
    renderCell={({ point, display }) => point.column === 1
      ? <span><span style={{ color: "var(--link)" }}>{display.replace(/ [A-Z]$/, "")}</span>{display.match(/ [A-Z]$/)?.[0]}</span>
      : undefined}
  />
  </>
);

export default { width: 839, height: 141, render } satisfies V3FixtureModule;
