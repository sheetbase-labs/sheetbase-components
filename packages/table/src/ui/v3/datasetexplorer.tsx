/**
 * COMP-02.6 visual fixture: the Dataset explorer grid (AMB 250 daily readings,
 * DS-0298), rendered from the design's own table under `themes/v3.css` at the
 * design's grid box (839×252), for comparison with a crop of the ELN design
 * render.
 *
 * Crop box (DatasetExplorer renders, 1440×1000, scale 1): x=256 y=232 w=835
 * h=253 — the grid wrapper's border box over a 28px single-tier header and
 * eight 28px rows. The first visible reading is 61, and the design window skips
 * readings 65–72 (rows hidden), so the data lives at absolute rows 61–64 and
 * 73–76 and the viewport is scrolled past the sixty rows above.
 *
 * Columns, header labels, widths, alignment and the selected Osmolality column
 * come from `canvas/DatasetExplorer.dc.html` / `DatasetExplorer-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

// The design right-aligns the numeric headers (`th style="text-align: right"`)
// and marks the two missing-unit headers (`Glucose (unit?)`, `Osmolality
// (unit?)`) `.warn`; the grid offers no header-alignment or header-ink prop,
// so — as in the other v3 fixtures — the design presentation is applied here.
const designOverrides = `
#grid-fixture .spreadsheet .column-header[aria-label^="B "],
#grid-fixture .spreadsheet .column-header[aria-label^="D "],
#grid-fixture .spreadsheet .column-header[aria-label^="E "],
#grid-fixture .spreadsheet .column-header[aria-label^="F "],
#grid-fixture .spreadsheet .column-header[aria-label^="G "],
#grid-fixture .spreadsheet .column-header[aria-label^="H "],
#grid-fixture .spreadsheet .column-header[aria-label^="I "],
#grid-fixture .spreadsheet .column-header[aria-label^="J "] { justify-content: flex-end; }
#grid-fixture .spreadsheet .column-header[aria-label^="F "] .column-name,
#grid-fixture .spreadsheet .column-header[aria-label^="H "] .column-name { color: var(--orange-text); }
#grid-fixture .spreadsheet .column-header[aria-label^="H "] {
  background: var(--selection-subtle);
  color: var(--text);
  box-shadow: inset 0 -2px 0 var(--accent);
}
#grid-fixture .spreadsheet .row-header { font-weight: 400; }
#grid-fixture .spreadsheet .grid-corner {
  justify-content: flex-end;
  padding-right: 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
#grid-fixture .spreadsheet .grid-corner::after { content: "Row"; }
`;

type Header = readonly [id: string, label: string];

const headers: readonly Header[] = [
  ["vessel", "Vessel"],
  ["day", "Day"],
  ["time", "Time"],
  ["vcd", "VCD (×10⁶ cells/mL)"],
  ["viability", "Viability (%)"],
  ["glucose", "Glucose (unit?)"],
  ["lactate", "Lactate (g/L)"],
  ["osmolality", "Osmolality (unit?)"],
  ["ph", "pH"],
  ["do", "DO (%)"],
];

// The design's table is `width:100%` with auto layout, so its columns land on
// fractional (content-driven) widths. These are the measured fractions from
// that render, including the 41.609px row-number gutter.
const rowHeaderWidth = 41.609;
const widths = [55.484, 39.609, 54.797, 136, 88.516, 105.484, 91.719, 119.422, 46.266, 60.094];

// Non-contiguous readings: 61–64 then 73–76 (the design hides rows 65–72).
const rowNumbers = [61, 62, 63, 64, 73, 74, 75, 76];
const rows: readonly (readonly string[])[] = [
  ["V01", "5", "08:50", "8.1", "96.4", "3.1", "1.2", "302", "7.05", "40"],
  ["V02", "5", "08:52", "7.8", "96.0", "3.3", "1.1", "299", "7.06", "41"],
  ["V03", "5", "08:54", "8.4", "96.8", "2.9", "1.3", "305", "7.04", "40"],
  ["V04", "5", "08:56", "7.5", "95.7", "3.4", "1.0", "298", "7.07", "39"],
  ["V01", "6", "09:06", "12.4", "95.1", "2.4", "1.6", "309", "7.02", "40"],
  ["V02", "6", "09:08", "11.9", "95.3", "2.6", "1.5", "306", "7.03", "40"],
  ["V03", "6", "09:10", "12.8", "94.8", "2.2", "1.7", "311", "7.01", "41"],
  ["V04", "6", "09:12", "11.2", "95.5", "2.7", "1.4", "304", "7.04", "40"],
];

const data = new Map<string, string>();
rows.forEach((row, offset) => {
  const rowNumber = rowNumbers[offset];
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowNumber}`, value);
  });
});

// The design right-aligns every numeric column (`.r` / `text-align: right`).
// The selected Osmolality column paints `--selection-subtle` on its cells.
const formats = new RangeStore<CellFormat>();
for (const column of [1, 3, 4, 5, 6, 7, 8, 9]) {
  formats.write({ start: { row: 0, column }, end: { row: 76, column } }, { horizontalAlign: "right" });
}
formats.write({ start: { row: 0, column: 7 }, end: { row: 76, column: 7 } }, { horizontalAlign: "right", background: "var(--selection-subtle)" });

// The design window skips readings 65–72 with no visible seam; a hairline
// height hides them without the engine's `.after-hidden-row` divider.
const rowCount = 76;
const rowHeights = Array.from({ length: rowCount }, (_, row) => (row >= 64 && row < 72 ? 0.01 : 28));
const scrollTop = 60 * 28;

const render = (theme: "light" | "dark") => (
  <>
    <style>{designOverrides}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights,
        // The design paints no active cell; this is the component's own default
        // selection (grid row 6, column C), kept explicit for the state type.
        selection: { anchor: { row: 5, column: 2 }, focus: { row: 5, column: 2 } },
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
        datasetId: "ds-0298",
        recordIdForRow: (row) => String(row + 1),
        fields: headers.map(([id, label], column) => ({
          id,
          label,
          column,
          writable: false,
        })),
      }}
    />
  </>
);

export default { width: 835, height: 253, render } satisfies V3FixtureModule;
