/**
 * COMP-02.6 visual fixture: the Notebook sheet block grid (nine clarification
 * runs of DS-0311, with a "New run" append row).
 *
 * Crop box (Notebook renders, 1440×1840, scale 1): x=264 y=667 w=839 h=333 —
 * the grid wrapper's border box. The `.g num` table is 843×332
 * (265,667.5) but the crop keeps the wrapper's 839px width, so the rightmost
 * four pixels of the last column are clipped identically in both images.
 *
 * The design's header is two-tier: a 24px group row
 * ("Run · this experiment" / "Measured · DS-0311 ELISA / turbidity" /
 * "Derived") over a 28px column row. The grid renders the group row from
 * `columnGroups` (a fixed 20px band) so `headerHeight` is 32 to keep the same
 * 52px total and the rows below aligned.
 *
 * Columns, widths, states and rows come from `canvas/Notebook.dc.html` and
 * the live DOM of `Notebook-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

/**
 * The design's two-tier header and states don't map onto the grid's fixed v3
 * presentation, so — as in the other v3 fixtures — the design presentation is
 * applied here:
 *  - the group band is a fixed 20px box at 12px; the design's is 24px at 11px
 *    over a 28px column row, so the band is re-sized and the column row is
 *    pushed down to keep the 52px header total;
 *  - the grid centres cell text in a 27px content box, which sits one device
 *    pixel lower than the design's collapsed-border cells;
 *  - the design right-aligns the numeric column headers (`th … .r`) but the
 *    grid only aligns cell values, and it disables the invalid corner mark via
 *    `--grid-invalid-mark-size` (the design shows it) while painting the
 *    selected row header with the muted surface instead of the selection wash.
 */
const designOverrides = `
#grid-fixture { --grid-invalid-mark-size: 7px; }
#grid-fixture .column-group-header { height: 24px !important; font-size: 11px; background: var(--surface); color: var(--muted); }
#grid-fixture .column-header { top: calc(var(--sheet-scroll-top, 0px) + 24px) !important; height: 28px !important; }
#grid-fixture .grid-cell { padding-bottom: 2px; }
#grid-fixture .row-header.selected-header { background: var(--selection); color: var(--text); font-weight: 500; }
#grid-fixture .column-header[aria-label^="C "],
#grid-fixture .column-header[aria-label^="D "],
#grid-fixture .column-header[aria-label^="E "],
#grid-fixture .column-header[aria-label^="F "] { justify-content: flex-end; }
`;

type Header = readonly [id: string, label: string];

const headers: readonly Header[] = [
  ["condition", "Condition"],
  ["filter_train", "Filter train"],
  ["load", "Load (L/m²)"],
  ["turbidity_out", "Turbidity out (NTU)"],
  ["capsid_titre", "Capsid titre (cp/mL)"],
  ["step_yield", "Step yield (%)"],
  ["meets_criteria", "Meets criteria"],
];

// Widths are the design's measured fractional (content-driven) values,
// including the 36px row-number gutter.
const rowHeaderWidth = 36;
const widths = [76.859, 105.469, 90.641, 136.391, 139.953, 130.078, 127.609];

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

// The design right-aligns the numeric columns (`.r` on every data cell).
const formats = new RangeStore<CellFormat>();
for (const column of [2, 3, 4, 5]) {
  formats.write({ start: { row: 0, column }, end: { row: rows.length - 1, column } }, { horizontalAlign: "right" });
}

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

// rowCount includes the append row (index 9), one past the nine runs.
const rowCount = rows.length + 1;

const render = (theme: "light" | "dark") => (
  <>
    <style>{designOverrides}</style>
    <Spreadsheet
      theme={theme}
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights: Array.from({ length: rowCount }, () => 28),
        // The design's active cell is the invalid C-150 turbidity (grid row 9).
        selection: { anchor: { row: 8, column: 3 }, focus: { row: 8, column: 3 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rowCount}
      columnCount={headers.length}
      headerHeight={32}
      defaultRowHeight={28}
      rowHeaderWidth={rowHeaderWidth}
      fieldColumns={new Set(headers.map((_, index) => index))}
      computedColumns={new Set([5, 6])}
      columnGroups={[
        { label: "Run · this experiment", columns: [0, 1, 2] },
        { label: "Measured · DS-0311 ELISA / turbidity", columns: [3, 4] },
        { label: "Derived", columns: [5, 6] },
      ]}
      datasetHeader={{
        datasetId: "notebook-runs",
        recordIdForRow: (row) => rows[row]?.[0],
        fields: headers.map(([id, label], column) => ({
          id,
          label,
          column,
          writable: false,
        })),
      }}
      // The design's C-150 turbidity is the invalid cell (danger wash + accent outline).
      cellState={(row, column) => (row === 8 && column === 3 ? "invalid" : undefined)}
      // The design's record column renders each value in the link colour.
      renderCell={({ point, display }) => point.column === 1
        ? <span><span style={{ color: "var(--link)" }}>{display.replace(/ [A-Z]$/, "")}</span>{display.match(/ [A-Z]$/)?.[0]}</span>
        : undefined}
      appendRow
    />
  </>
);

export default { width: 839, height: 333, render } satisfies V3FixtureModule;
