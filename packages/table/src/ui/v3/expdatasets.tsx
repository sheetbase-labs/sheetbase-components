/**
 * COMP-02.6 visual fixture: the Datasets tab grid (ExpDatasets "DS-0311 rows").
 *
 * Crop box (ExpDatasets renders, 1440×1000, scale 1): x=256 y=319 w=855 h=337
 * — the grid wrapper's box; the `.g` table is 257,319.5 859×336, so the crop
 * clips the last few pixels of the Captured column.
 *
 * The grid is a window into a 98-row dataset: the first visible row is 81, the
 * view sits at absolute rows 81–89 then 97–98 (rows 90–96 have height 0), and
 * row 88 holds the active (invalid) Result cell. Columns, labels, widths,
 * states and rows come from `canvas/ExpDatasets.dc.html` and its live DOM.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

type Header = readonly [id: string, label: string];

const headers: readonly Header[] = [
  ["sample", "Sample"],
  ["condition", "Condition"],
  ["assay", "Assay"],
  ["plate_well", "Plate / well"],
  ["dilution", "Dilution"],
  ["raw", "Raw"],
  ["result", "Result"],
  ["unit", "Unit"],
  ["status", "Status"],
  ["captured", "Captured"],
];

// Fractional widths measured from the design render: the `.g` table is
// `width:100%` with auto layout, so integer column lines shift every glyph.
const rowHeaderWidth = 41.609;
const widths = [75.594, 92.516, 72.203, 80.328, 63.469, 78.047, 78.563, 56.547, 116.734, 103.391];

const firstRow = 81;
// Rows 81–89, then 97–98; 90–96 are gap rows (height 0).
const rows: readonly (readonly [number, readonly string[]])[] = [
  [81, ["SMP-2246", "C-50", "ELISA", "P3 · E1", "1:2000", "0.812 OD", "6.8 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [82, ["SMP-2246", "C-50", "ELISA", "P3 · E2", "1:2000", "0.834 OD", "7.0 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [83, ["SMP-2246", "C-50", "Turbidity", "TB-02", "1:1", "12.7", "12.7", "NTU", "Valid", "24 Sep 15:52"]],
  [84, ["SMP-2247", "C-100", "ELISA", "P3 · F1", "1:2000", "0.741 OD", "6.1 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [85, ["SMP-2247", "C-100", "ELISA", "P3 · F2", "1:2000", "0.763 OD", "6.3 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [86, ["SMP-2247", "C-100", "Turbidity", "TB-02", "1:1", "24.3", "24.3", "NTU", "Valid", "24 Sep 15:55"]],
  [87, ["SMP-2248", "C-150", "ELISA", "P3 · G1", "1:2000", "0.662 OD", "5.3 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [88, ["SMP-2248", "C-150", "Turbidity", "TB-02", "1:1", "61.5", "61.5", "NTU", "Out of range", "24 Sep 15:58"]],
  [89, ["SMP-2248", "C-150", "ELISA", "P3 · G2", "1:2000", "0.684 OD", "5.5 × 10¹¹", "cp/mL", "Valid", "24 Sep 15:40"]],
  [97, ["SMP-2249", "C-150 · 1:5", "ELISA", "P4 · G1", "1:400", "—", "—", "cp/mL", "Pending · 11:30", "—"]],
  [98, ["SMP-2249", "C-150 · 1:5", "Turbidity", "TB-02", "1:5", "—", "—", "NTU", "Pending · 10:30", "—"]],
];

const data = new Map<string, string>();
for (const [rowNumber, cells] of rows) {
  cells.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowNumber}`, value);
  });
}

// Numeric columns right-align, the whole Captured column is muted, and rows
// 97–98 (planned measurements with no values) render their Raw/Result/Status
// in the same muted ink. The active Result cell's status is the danger tone.
const formats = new RangeStore<CellFormat>();
formats.write({ start: { row: 80, column: 4 }, end: { row: 88, column: 6 } }, { horizontalAlign: "right" });
formats.write({ start: { row: 96, column: 4 }, end: { row: 96, column: 4 } }, { horizontalAlign: "right" });
formats.write({ start: { row: 96, column: 5 }, end: { row: 97, column: 6 } }, { horizontalAlign: "right", foreground: "var(--muted)" });
formats.write({ start: { row: 80, column: 9 }, end: { row: 97, column: 9 } }, { horizontalAlign: "right", foreground: "var(--muted)" });
formats.write({ start: { row: 96, column: 8 }, end: { row: 97, column: 8 } }, { foreground: "var(--muted)" });
formats.write({ start: { row: 87, column: 8 }, end: { row: 87, column: 8 } }, { foreground: "var(--danger-text)" });

const rowCount = 98;
const rowHeights = Array.from({ length: rowCount }, () => 28);
for (let row = 89; row <= 95; row += 1) rowHeights[row] = 0;

const scrollTop = (firstRow - 1) * 28;

const render = (theme: "light" | "dark") => (
  // The design paints the selected row number with the selection wash and the
  // full-strength ink; the grid's v3 preset defaults that to the header
  // surface, so retint the two variables for this fixture.
  <div
    className="v3-expdatasets"
    style={{
      width: "100%",
      height: "100%",
      ["--grid-row-selected-surface" as string]: "var(--selection)",
      ["--grid-row-selected-ink" as string]: "var(--text)",
    }}
  >
    {/* The design's table cell lifts 13px text 1px above the grid's flex
        centring; nudge the cell content to the design baseline. The skipped
        rows 90–96 are an addressing device only — the design draws no
        "hidden rows above" rule, so drop the grid's accent border. */}
    <style>{`
.v3-expdatasets .grid-cell > span { position: relative; top: -1px; }
.v3-expdatasets .after-hidden-row { border-top: 0 !important; }
/* The grid has no per-column header alignment prop; the design right-aligns
   the Dilution, Raw, Result and Captured headings. */
.v3-expdatasets .column-header[aria-label^="E "],
.v3-expdatasets .column-header[aria-label^="F "],
.v3-expdatasets .column-header[aria-label^="G "],
.v3-expdatasets .column-header[aria-label^="J "] { justify-content: flex-end; }
`}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights,
        // The design's active cell is row 88's invalid Result (grid row 88).
        selection: { anchor: { row: 87, column: 6 }, focus: { row: 87, column: 6 } },
        scroll: { top: scrollTop, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rowCount}
      columnCount={headers.length}
      headerHeight={28}
      defaultRowHeight={28}
      rowHeaderWidth={rowHeaderWidth}
      fieldColumns={new Set(headers.map((_, index) => index))}
      datasetHeader={{
        datasetId: "ds-0311",
        recordIdForRow: (row) => rows.find(([rowNumber]) => rowNumber === row + 1)?.[1][0],
        fields: headers.map(([id, label], column) => ({ id, label, column, writable: false })),
      }}
      // The design's row 88 turbidity result is the out-of-range cell.
      cellState={(row, column) => (row === 87 && column === 6 ? "invalid" : undefined)}
      // The design renders Sample values in the 12px mono face.
      renderCell={({ point, display }) => point.column === 0
        ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{display}</span>
        : undefined}
    />
  </div>
);

export default { width: 855, height: 337, render } satisfies V3FixtureModule;
