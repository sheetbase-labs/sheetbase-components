/**
 * COMP-02.6 visual fixture: the Promote-columns dialog's local-column list
 * (SheetPromote.dc.html, table 1, `.t num`).
 *
 * Crop box (SheetPromote renders, 1440×1000, scale 1): x=401 y=361 w=632 h=100
 * — the bordered wrapper (1px `--border`, radius 6px) around the `.t` table.
 * The design's table is 402,362 636×97.5 inside that wrapper; the crop stops
 * ~5px short of the wrapper's right border, exactly where the grid's last
 * column rule is clipped, so neither shows a right edge strip.
 *
 * This is a record list, not a spreadsheet grid: no row-number gutter
 * (`rowHeaderWidth` 0), the design's own cell padding (10px, 12px in the first
 * column) and the 26px `.input` in "New field" (its value is rendered through
 * `renderCell`).
 */
import type { CSSProperties } from "react";
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

type Header = readonly [id: string, label: string];

const headers: readonly Header[] = [
  ["local_column", "Local column"],
  ["new_field", "New field"],
  ["type", "Type"],
  ["unit", "Unit"],
  ["rows_with_values", "Rows with values"],
];

// Fractional widths measured from the design's `width:100%` auto layout.
const widths = [102.609, 158.172, 212.672, 43.813, 118.734];

const rows: readonly (readonly string[])[] = [
  ["Visual clarity", "visual_clarity", "Choice: Clear, Slight haze, Hazy", "—", "9 of 9"],
  ["Adj. yield (%)", "adjusted_yield_pct", "Number, 0 dp", "%", "6 of 9"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

/**
 * The design's `.t` table is not the grid chrome: its cells pad 0 10px (12px
 * in the first column), it has no vertical rules and no selection ring, and it
 * carries a 1px border on all four sides. The v3 grid defaults (8px padding,
 * 1px right rules, accent selection) are re-pointed at the design's values for
 * this fixture only.
 */
const designOverrides = `
  #grid-fixture .spreadsheet {
    --grid-cell-padding-x: 10px;
    --grid-header-padding-x: 10px;
    border-bottom: 1px solid var(--border);
  }
  #grid-fixture .spreadsheet .grid-cell,
  #grid-fixture .spreadsheet .column-header { border-right: none; }
  #grid-fixture .spreadsheet .grid-cell[aria-colindex="1"],
  #grid-fixture .spreadsheet .column-header[aria-label^="A "] { padding-left: 12px; }
  /* The design has no active cell, so the default A1 selection must not tint
     or embolden the first header. */
  #grid-fixture .spreadsheet .column-header.selected-header {
    font-weight: 500;
    background: var(--grid-header-surface, var(--surface-muted));
    color: var(--grid-column-header-ink, var(--muted));
  }
  #grid-fixture .spreadsheet .row-header,
  #grid-fixture .spreadsheet .grid-corner,
  #grid-fixture .spreadsheet .selection-outline { display: none; }
`;

// The design's `.input`: 26px tall, 1px `--border`, 6px radius, 8px inline
// padding, `--surface` fill (`.sheetbase-scope input` inherits font/colour).
const inputStyle: CSSProperties = {
  width: "100%",
  height: 26,
  padding: "0 8px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface)",
  appearance: "none",
  outline: "none",
};

const render = (theme: "light" | "dark") => (
  <>
    <style>{designOverrides}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats: new RangeStore<CellFormat>(),
        columnWidths: widths,
        rowHeights: [33, 33],
        // The design paints no active cell; this is the component's own default
        // selection, kept explicit for the state type (the outline is hidden).
        selection: { anchor: { row: 5, column: 2 }, focus: { row: 5, column: 2 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rows.length}
      columnCount={headers.length}
      headerHeight={32}
      defaultRowHeight={33}
      rowHeaderWidth={0}
      datasetHeader={{
        datasetId: "sheet-promote",
        recordIdForRow: (row) => rows[row]?.[0],
        fields: headers.map(([id, label], column) => ({ id, label, column, writable: false })),
      }}
      renderCell={({ point, display }) => point.column === 1
        ? <input readOnly tabIndex={-1} defaultValue={display} style={inputStyle} />
        : undefined}
    />
  </>
);

export default { width: 632, height: 100, render } satisfies V3FixtureModule;
