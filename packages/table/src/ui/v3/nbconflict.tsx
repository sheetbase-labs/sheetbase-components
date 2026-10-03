/**
 * COMP-02.6 visual fixture: the NbConflict grid — the clarification-runs
 * notebook block after reconnecting, where run 6's Capsid titre carries a
 * save conflict ("2 values").
 *
 * Crop box (NbConflict renders, 1440×1000, scale 1): x=264 y=259 w=819 h=169 —
 * the grid wrapper's border box (the `.g` table is 265,260 823×168, clipped 4px
 * on the right). The grid is a window into the run list: the first visible run
 * is 4, so the data sits at grid rows 4–8 and the viewport is scrolled past the
 * three rows above it.
 *
 * Columns, widths, states and rows come from `canvas/NbConflict.dc.html` and
 * the live DOM of `NbConflict-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

/**
 * Extra CSS the v3 preset does not express (same pattern as `nbviewer.tsx`):
 *  - the design washes the conflicted run's row number with `--selection` and
 *    uses `--text`, but the row header's selected surface is the muted one;
 *  - the design right-aligns the numeric headers, but `.column-header` is
 *    `justify-content: flex-start` and never consults the column format;
 *  - the design paints no accent ring around the conflicted cell (only its
 *    warning border), so the selection outline is hidden;
 *  - `.spreadsheet[data-theme="dark"] .grid-cell` outranks
 *    `.grid-cell.cell-conflict` (which has no dark override in `grid.css`), so
 *    the conflict wash would vanish in dark without restating it here.
 */
const fixtureCss = `
.sheetbase-scope.spreadsheet[data-theme] {
  --grid-row-selected-surface: var(--selection);
  --grid-row-selected-ink: var(--text);
}
.sheetbase-scope.spreadsheet .column-header[aria-label^="C "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="D "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="E "],
.sheetbase-scope.spreadsheet .column-header[aria-label^="F "] { justify-content: flex-end; }
.sheetbase-scope.spreadsheet .row-header,
.sheetbase-scope.spreadsheet .row-header.selected-header { font-weight: 400; }
.sheetbase-scope.spreadsheet .selection-outline { display: none; }
.sheetbase-scope.spreadsheet[data-theme="dark"] .grid-cell.cell-conflict {
  background: var(--orange-soft);
  color: var(--orange-text);
}
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
const widths = [75.75, 98.281, 86.953, 134.453, 137.953, 127.969, 125.641];

// The design's first visible run is 4; the grid is a page into the full run
// list, so the data lives at absolute rows 4–8 (1-indexed).
const firstRun = 4;
// The conflict cell's own value never paints — the grid replaces it with the
// "2 values" copy — but the row needs a stored value to render.
const conflictValue = "7.9 × 10¹¹";
const rows: readonly (readonly string[])[] = [
  ["B-50", "MAT-0419 B", "50", "4.1", "7.8 × 10¹¹", "90.7", "Yes"],
  ["B-100", "MAT-0419 B", "100", "5.6", "7.6 × 10¹¹", "88.4", "Yes"],
  ["B-150", "MAT-0419 B", "150", "8.9", conflictValue, "—", "—"],
  ["C-50", "MAT-0420 C", "50", "12.7", "6.9 × 10¹¹", "80.2", "Yes"],
  ["C-100", "MAT-0420 C", "100", "24.3", "6.2 × 10¹¹", "72.1", "No · both"],
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

const totalRows = firstRun + rows.length; // 9: rows 1–3 empty, then 4–8
const scrollTop = (firstRun - 1) * 28;
// Run 6 (grid index 5, absolute row 6) is the conflicted run: its Capsid titre
// cell holds the conflict and its computed columns are withheld (muted).
const conflictRow = firstRun + 2;

const render = (theme: "light" | "dark") => (
  <>
    <style>{fixtureCss}</style>
    <Spreadsheet
    theme={theme}
    initialData={data}
    initialState={{
      data,
      formats,
      columnWidths: widths,
      rowHeights: Array.from({ length: totalRows }, () => 28),
      // The design's active cell is the conflicted Capsid titre cell (grid row 6).
      selection: { anchor: { row: conflictRow - 1, column: 4 }, focus: { row: conflictRow - 1, column: 4 } },
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
    // The design's run 6 Capsid titre is the conflicted cell (warning wash +
    // "2 values"); resolveCellState paints it from this state.
    cellState={(row, column) => (row === conflictRow - 1 && column === 4 ? { state: "conflict", count: 2 } : undefined)}
    // Step yield and Meets criteria for the conflicted run are withheld until
    // the conflict resolves — the design paints them muted.
    renderCell={({ point, display }) => point.row === conflictRow - 1 && (point.column === 5 || point.column === 6)
      ? <span style={{ color: "var(--muted)" }}>{display}</span>
      : undefined}
    />
  </>
);

export default { width: 819, height: 169, render } satisfies V3FixtureModule;
