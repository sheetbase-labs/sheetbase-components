/**
 * COMP-02.6 visual fixture: the ReviewRecord reviewer grid ("Transfection
 * results", in review, round 2).
 *
 * Crop box (ReviewRecord renders, 1440×1000, scale 1): x=294 y=537 w=794 h=141
 * — the design's grid frame (1px top/left border + 6px left radius) around the
 * `.g num` table: a 36px row-number gutter and six data columns over a 28px
 * single-tier header and four 28px rows. Row 3's Genome titre cell carries the
 * review annotation — the design paints it with a review wash, a 2px inset
 * review border and a struck-through previous value before the new one.
 *
 * Columns, widths and states come from `canvas/ReviewRecord.dc.html` and the
 * live DOM of `ReviewRecord-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

type Header = readonly [id: string, label: string, computed: boolean];

const headers: readonly Header[] = [
  ["condition", "Condition", false],
  ["pei_dna", "PEI:DNA (w/w)", false],
  ["genome_titre", "Genome titre (vg/mL)", false],
  ["viability", "Viability at harvest (%)", false],
  ["titre_vs", "Titre vs 2:1 (%)", true],
  ["meets_criteria", "Meets criteria", true],
  // A zero-width sentinel column gives the selection outline somewhere
  // off-screen to sit, so no active cell is painted over the design's static
  // table (the design render has no selection).
  ["", "", false],
];

const rowHeaderWidth = 36;
const widths = [77.109, 106.813, 148.594, 157.797, 138.781, 127.906, 0];

const rows: readonly (readonly string[])[] = [
  ["R1.0", "1:1", "3.1 × 10¹⁰", "88.1", "43.1", "Viability yes"],
  ["R1.5", "1.5:1", "5.8 × 10¹⁰", "85.4", "80.6", "Viability yes"],
  // Row 3: the review annotation lives on the Genome titre cell. The map holds
  // the returned value; the superseded value is painted by `renderCell`.
  ["R2.0", "2:1", "7.2 × 10¹⁰", "81.9", "100.0", "Viability yes"],
  ["R3.0", "3:1", "6.4 × 10¹⁰", "72.6", "88.9", "Viability no"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

const DANGER = { foreground: "var(--danger-text)" } satisfies CellFormat;
const DERIVED = { background: "var(--surface-derived)" } satisfies CellFormat;
const RIGHT = { horizontalAlign: "right" } satisfies CellFormat;

// Formats are last-write-wins: each write replaces the cell's whole format, so
// later per-cell writes restate the column's alignment/background.
const formats = new RangeStore<CellFormat>();
const column = (index: number): { start: { row: number; column: number }; end: { row: number; column: number } } => ({
  start: { row: 0, column: index },
  end: { row: rows.length - 1, column: index },
});
for (const index of [1, 2, 3]) formats.write(column(index), RIGHT);
// The computed columns right-align and carry the derived surface (`.r.der` /
// `.der`); the last column is left-aligned.
formats.write(column(4), { ...RIGHT, ...DERIVED });
formats.write(column(5), DERIVED);
// Row 4's viability and Meets criteria values are danger text.
formats.write({ start: { row: 3, column: 3 }, end: { row: 3, column: 3 } }, { ...RIGHT, ...DANGER });
formats.write({ start: { row: 3, column: 5 }, end: { row: 3, column: 5 } }, { ...DERIVED, ...DANGER });

// Row 3's Genome titre cell is the review annotation (wash + 2px review inset).
// The v3 tokens carry the light and dark values, so the tones switch with the
// grid's own `data-theme`.
const review = { wash: "var(--purple-soft)", border: "var(--purple)", deleteWash: "var(--danger-soft)" };

// The zero-width sentinel column carries the selection outline off-screen.
const rowCount = rows.length;

// The design right-aligns the numeric column headers (`th.r`), but the grid's
// `.column-header` is hard-wired left-aligned and never consults the column
// format (no alignment prop). Apply the design's presentation here, as the
// other v3 fixtures do.
const reviewCss = `
#grid-fixture .spreadsheet .column-header[aria-label^="B "],
#grid-fixture .spreadsheet .column-header[aria-label^="C "],
#grid-fixture .spreadsheet .column-header[aria-label^="D "],
#grid-fixture .spreadsheet .column-header[aria-label^="E "] { justify-content: flex-end; }
`;

const render = (theme: "light" | "dark") => {
  formats.write({ start: { row: 2, column: 2 }, end: { row: 2, column: 2 } }, { ...RIGHT, background: review.wash });
  return (
    <>
    <style>{reviewCss}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights: rows.map(() => 28),
        selection: { anchor: { row: 0, column: headers.length - 1 }, focus: { row: 0, column: headers.length - 1 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rowCount}
      columnCount={headers.length}
      headerHeight={28}
      defaultRowHeight={28}
      rowHeaderWidth={rowHeaderWidth}
      fieldColumns={new Set(headers.map((_, index) => index))}
      computedColumns={new Set([4, 5])}
      datasetHeader={{
        datasetId: "transfection-results",
        recordIdForRow: (row) => rows[row]?.[0],
        fields: headers.map(([id, label, computed], index) => ({
          id,
          label,
          column: index,
          computed,
          writable: false,
        })),
      }}
      renderCell={({ point, display }) => {
        if (point.row !== 2 || point.column !== 2) return undefined;
        return (
          <>
            <span
              aria-hidden
              style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: `inset 0 0 0 2px ${review.border}` }}
            />
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <del style={{ fontSize: 11, marginRight: 6, padding: "0 1px", color: "var(--muted)", background: review.deleteWash }}>
                6.9 × 10¹⁰
              </del>
              {display}
            </span>
          </>
        );
      }}
    />
    </>
  );
};

export default { width: 794, height: 141, render } satisfies V3FixtureModule;
