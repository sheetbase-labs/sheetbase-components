/**
 * COMP-02.6 visual fixture: the NbViewer grid — the read-only notebook viewer's
 * "Clarification runs" table.
 *
 * Crop box (NbViewer renders, 1440×1000, scale 1): x=264 y=370 w=839 h=281 —
 * the grid wrapper's border box (the `.g` table is 265,371 843×280). The grid is
 * a single-tier header (28px, no source badges) over a 36px row-number gutter
 * and seven columns (76.859/105.453/90.641/136.391/139.953/130.078/127.625) and
 * nine 28px rows.
 *
 * Columns, widths, alignment, states and rows come from `canvas/NbViewer.dc.html`
 * and the live DOM of `NbViewer-light.png`. The design's active cell is the
 * Capsid titre cell of row 4, with a two-cell (Turbidity + Capsid) selection and
 * the row number washed; row 9 Turbidity 61.5 is invalid; row 3 Meets criteria
 * reads "No · yield".
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet, type DatasetFieldHeader } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

/** Extra CSS the v3 preset does not express: the design's selection paint and
 *  its right-aligned numeric headers. The grid exposes neither as a prop. */
const fixtureCss = `
.sheetbase-scope.spreadsheet[data-theme] {
  --grid-selection-fill: var(--selection);
  --grid-row-selected-surface: var(--selection);
  --grid-row-selected-ink: var(--text);
}
.sheetbase-scope.spreadsheet .column-header { gap: 4px; }
.sheetbase-scope.spreadsheet .column-header .fx { line-height: 12px; }
.sheetbase-scope.spreadsheet .column-header.selected-header {
  font-weight: 500;
  background: var(--grid-header-surface);
  color: var(--grid-column-header-ink);
}
.sheetbase-scope.spreadsheet .grid-cell.cell-invalid { font-weight: 400; }
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

const rows: readonly (readonly string[])[] = [
  ["A-50", "MAT-0418 A", "50", "6.2", "7.4 × 10¹¹", "86.0", "Yes"],
  ["A-100", "MAT-0418 A", "100", "9.8", "7.1 × 10¹¹", "82.6", "Yes"],
  ["A-150", "MAT-0418 A", "150", "18.4", "6.5 × 10¹¹", "75.6", "No · yield"],
  ["B-50", "MAT-0419 B", "50", "4.1", "7.8 × 10¹¹", "90.7", "Yes"],
  ["B-100", "MAT-0419 B", "100", "5.6", "7.6 × 10¹¹", "88.4", "Yes"],
  ["B-150", "MAT-0419 B", "150", "8.9", "7.3 × 10¹¹", "84.9", "Yes"],
  ["C-50", "MAT-0420 C", "50", "12.7", "6.9 × 10¹¹", "80.2", "Yes"],
  ["C-100", "MAT-0420 C", "100", "24.3", "6.2 × 10¹¹", "72.1", "No · both"],
  ["C-150", "MAT-0420 C", "150", "61.5", "5.4 × 10¹¹", "62.8", "No · both"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

// The design right-aligns the numeric columns (`.r` / `.r der` on every cell).
const formats = new RangeStore<CellFormat>();
for (const column of [2, 3, 4, 5]) {
  formats.write({ start: { row: 0, column }, end: { row: rows.length - 1, column } }, { horizontalAlign: "right" });
}

const fields: DatasetFieldHeader[] = headers.map(([id, label, computed], column) => ({
  id,
  label,
  column,
  computed,
  writable: false,
}));

const render = (theme: "light" | "dark") => (
  <>
    <style>{fixtureCss}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights: rows.map(() => 28),
        // Row 4: Turbidity (D) through Capsid (E) selected; the active cell is
        // the Capsid titre cell (E4), matching the design's accent outline.
        selection: { anchor: { row: 3, column: 3 }, focus: { row: 3, column: 4 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rows.length}
      columnCount={headers.length}
      headerHeight={28}
      defaultRowHeight={28}
      rowHeaderWidth={rowHeaderWidth}
      fieldColumns={new Set(headers.map((_, index) => index))}
      computedColumns={new Set([5, 6])}
      datasetHeader={{
        datasetId: "clarification-runs",
        recordIdForRow: (row) => rows[row]?.[0],
        fields,
      }}
      // The design's C-150 turbidity reading is the invalid cell (danger wash).
      cellState={(row, column) => (row === 8 && column === 3 ? "invalid" : undefined)}
    />
  </>
);

export default { width: 839, height: 281, render } satisfies V3FixtureModule;
