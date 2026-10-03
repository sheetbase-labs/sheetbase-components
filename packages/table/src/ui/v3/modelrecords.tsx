/**
 * COMP-02.6 visual fixture: the Model Cell bank records list ("Cell bank",
 * model MDL-0019) — the design's `.t num` record table.
 *
 * Crop box (ModelRecords renders, 1440×1000, scale 1): x=256 y=260 w=860 h=265
 * — the card's border box: a 1px frame around an 858px table of eight columns
 * (95.59/164/90.47/77.78/83.03/127.88/113.78/105.47) with a 31px header over
 * seven 33px rows. Columns, labels, widths, states and rows come from
 * `canvas/ModelRecords.dc.html` / `ModelRecords-light.png`.
 *
 * The design table is `.t num` (a record list), not the `.g` sheet grid: it has
 * no row-number gutter, no vertical cell rules, 10px cell padding, and its
 * selected record row paints `--selection`. The fixture therefore sizes the
 * grid to the design's card box and overrides the sheet-grid chrome locally
 * (padding, rules, frame) rather than changing the shared theme.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

const headers = ["ID", "Name", "Cell line", "Passage", "Vials left", "Location", "Status", "Mycoplasma"] as const;

// Measured fractional widths from the design's auto-laid-out table; they sum to
// the 858px content box.
const widths = [95.594, 164, 90.469, 77.781, 83.031, 127.875, 113.781, 105.469];

type StatusTone = "ok" | "warn" | "review" | "stored" | "bad";

// Design `.dot` colours: st-ok/st-warn/st-review/st-stored/st-bad.
const dotColour: Record<StatusTone, string> = {
  ok: "var(--green)",
  warn: "var(--orange)",
  review: "var(--purple)",
  stored: "var(--muted)",
  bad: "var(--danger)",
};

type Row = readonly [id: string, name: string, cellLine: string, passage: string, vials: string, location: string, status: string, mycoplasma: string, tone: StatusTone];

const rows: readonly Row[] = [
  ["CB-0012", "HEK293 WCB lot 3", "HEK293", "P12", "31 of 50", "LN2-2 · rack C", "Released", "—", "ok"],
  ["CB-0011", "HEK293 WCB lot 2", "HEK293", "P12", "4 of 50", "LN2-2 · rack C", "Low stock", "Negative", "warn"],
  ["CB-0010", "HEK293 MCB", "HEK293", "P8", "18 of 20", "LN2-1 · rack A", "Released", "Negative", "ok"],
  ["CB-0009", "Sf9 WCB lot 1", "Sf9", "P20", "22 of 40", "LN2-2 · rack D", "In review", "Pending", "review"],
  ["CB-0008", "HEK293T WCB lot 5", "HEK293T", "P15", "0 of 40", "—", "Depleted", "Negative", "stored"],
  ["CB-0007", "CHO-K1 MCB", "CHO-K1", "P6", "12 of 20", "LN2-1 · rack B", "Quarantine", "Positive", "bad"],
  ["CB-0006", "HEK293 WCB lot 1", "HEK293", "P12", "0 of 50", "—", "Depleted", "Negative", "stored"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  for (let column = 0; column < headers.length; column++) {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, row[column]);
  }
});

const formats = new RangeStore<CellFormat>();
// "Vials left" is right-aligned (`.r` on the header and every cell).
formats.write({ start: { row: 1, column: 4 }, end: { row: rows.length - 1, column: 4 } }, { horizontalAlign: "right" });
// The design's first record row is selected (`.sel`): `--selection` across it.
formats.write({ start: { row: 0, column: 0 }, end: { row: 0, column: 3 } }, { background: "var(--selection)" });
formats.write({ start: { row: 0, column: 5 }, end: { row: 0, column: 7 } }, { background: "var(--selection)" });
// RangeStore is last-write-wins, so the selected row's E1 carries both.
formats.write({ start: { row: 0, column: 4 }, end: { row: 0, column: 4 } }, { background: "var(--selection)", horizontalAlign: "right" });

// The design's `.t` record list differs from the `.g` sheet grid the component
// draws by default: 10px cell padding, no vertical rules, `--border-subtle`
// row rules, a full 1px frame with all corners rounded, and a selected record
// row with no cell-selection outline.
const chrome = `
  /* The rounded card corners reveal the page behind the grid; the host now
     carries the .sheetbase-scope theme variables, so the page background is
     the design's --app token in both themes. */
  #grid-fixture { background: var(--app); }
  #grid-fixture .spreadsheet {
    --grid-cell-padding-x: 10px;
    --grid-header-padding-x: 10px;
    --grid-line-color: transparent;
    --grid-frame-radius: 6px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  #grid-fixture .spreadsheet .grid-cell { border-bottom-color: var(--border-subtle); }
  #grid-fixture .spreadsheet .column-header { border-bottom-color: var(--border); }
  /* The design's .t cells carry no right border; removing it (not just its
     colour) widens the content box by 1px so right-aligned text lands where
     the design's text-align: right puts it. */
  #grid-fixture .spreadsheet .grid-cell,
  #grid-fixture .spreadsheet .column-header { border-right-width: 0; }
  #grid-fixture .spreadsheet .selection-outline { display: none; }
  /* rowHeaderWidth is 0 (the design's record list has no gutter); the
     zero-width row headers still paint their 8px padding + border. */
  #grid-fixture .spreadsheet .row-header,
  #grid-fixture .spreadsheet .grid-corner { display: none; }
  /* Design .t .r: the "Vials left" header right-aligns with its column. */
  #grid-fixture .spreadsheet .column-header[aria-label^="E "] { justify-content: flex-end; }
  /* Design th padding-left: 24px on the ID column. */
  #grid-fixture .spreadsheet .column-header[aria-label^="A "] { padding-left: 24px; }
`;

const render = (theme: "light" | "dark") => (
  <>
    <style>{chrome}</style>

    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats,
        columnWidths: widths,
        rowHeights: rows.map(() => 33),
        // The design's selected record is row 1; its `--selection` surface is
        // painted by the row-0 format below. The grid's own cell selection is
        // pinned to A1 and its outline hidden by the fixture chrome, because
        // the design's list selection shows no active-cell outline.
        selection: { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rows.length}
      columnCount={headers.length}
      headerHeight={32}
      defaultRowHeight={33}
      rowHeaderWidth={0}
      fieldColumns={new Set(headers.map((_, index) => index))}
      datasetHeader={{
        datasetId: "cell-bank",
        fields: headers.map((label, column) => ({ id: `f${column}`, label, column, writable: false })),
      }}
      renderCell={({ point, display }) => {
        // The ID column is a monospace record link (`.mono` inside `a`).
        if (point.column === 0) {
          return <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--link)", marginLeft: 14, position: "relative", top: 1 }}>{display}</span>;
        }
        // The status column is a coloured dot plus a legible label.
        if (point.column === 6) {
          const tone = rows[point.row]?.[8] ?? "stored";
          return (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColour[tone], marginRight: 6, flex: "none" }} />
              {display}
            </span>
          );
        }
        return undefined;
      }}
    />
  </>
);

export default { width: 860, height: 265, render } satisfies V3FixtureModule;
