/**
 * COMP-02.6 visual fixture: the Import step 2 preview grid ("Rows to import").
 *
 * Crop box (ImportMap renders, 1440×1000, scale 1): x=264 y=513 w=839 h=169 —
 * the grid's outer border on the crop's top-left edge (the `.g` table is
 * 265,513.5 843×168). The grid is a window into the full 34-row preview: the
 * first visible row is 97, then the five flagged rows 97/98/112/113/114 with
 * 99–111 collapsed to zero height.
 *
 * Columns, widths, states and rows come from `canvas/ImportMap.dc.html` and the
 * live DOM of `ImportMap-light.png`.
 */
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

type Header = readonly [id: string, label: string];

const headers: readonly Header[] = [
  ["sample", "Sample"],
  ["well", "Well"],
  ["dilution", "Dilution"],
  ["raw_od", "Raw (OD)"],
  ["result", "Result (cp/mL)"],
  ["outcome", "Outcome"],
];

const rowHeaderWidth = 41.375;
const widths = [102.234, 57.438, 84.094, 98.703, 139.203, 319.953];

type Outcome = Readonly<{ dot: "ok" | "bad" | "warn" | "draft"; color?: string }>;

// The design's first visible row is 97; the grid is a page into the full import
// list, so the data lives at absolute rows 97–114 (1-indexed). Rows 99–111 are
// collapsed to zero height, leaving the flagged rows 112/113/114 adjacent.
const rowHeights: number[] = Array.from({ length: 96 }, () => 28); // rows 1–96 (above the window)
rowHeights.push(28, 28); // 97, 98
rowHeights.push(...Array.from({ length: 13 }, () => 0)); // 99–111 collapsed
rowHeights.push(28, 28, 28); // 112, 113, 114
rowHeights.push(28); // trailing row so the window fills the viewport
const rowCount = rowHeights.length;

const firstRow = 97;
const rows: readonly (readonly string[])[] = [
  ["SMP-2249", "G1", "1:400", "0.412", "5.2 × 10¹¹", "Fills planned row 97"],
  ["SMP-2249", "G2", "1:400", "0.398", "5.0 × 10¹¹", "New row"],
  ["SMP-2253", "H7", "1:2000", "3.912", "—", "Above curve (OD > 3.0), no result"],
  ["SMP-2253", "H8", "1:2000", "1.022", "8.9 × 10¹¹", "Replicate CV 31 % (limit 20 %)"],
  ["BLANK", "A12", "—", "0.051", "—", "Control, not imported"],
];

// Absolute grid row index (0-based) for each visible data row, and its status
// dot / text tone as painted by the design.
const rowIndices = [96, 97, 111, 112, 113];
const outcomes: Readonly<Record<number, Outcome>> = {
  96: { dot: "ok" },
  97: { dot: "ok" },
  111: { dot: "bad", color: "var(--danger-text)" },
  112: { dot: "warn", color: "var(--orange-text)" },
  113: { dot: "draft", color: "var(--muted)" },
};

const data = new Map<string, string>();
rows.forEach((row, offset) => {
  const rowNumber = rowIndices[offset] + 1;
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowNumber}`, value);
  });
});

// The design right-aligns the numeric columns (`.r` on every Dilution/Raw/Result
// header and cell).
const formats = new RangeStore<CellFormat>();
for (const column of [2, 3, 4]) {
  formats.write({ start: { row: 0, column }, end: { row: rowCount - 1, column } }, { horizontalAlign: "right" });
}

// The design's status-dot tones, minus `draft` (its neutral dot has no v3
// theme variable, so it is resolved per theme at render time).
const DOT_COLOR: Record<Outcome["dot"], string> = {
  ok: "var(--green)",
  warn: "var(--orange)",
  bad: "var(--danger)",
  draft: "var(--palette-muted-3)",
};

// The design's table cell lifts 13px text 1px above the grid's flex centring,
// so nudge the plain-text columns to the design baseline (the status column's
// own inline-flex content already lands there, and nudging it would move the
// dot). The skipped rows 99–111 are an addressing device only — the design
// draws no "hidden rows above" rule, so drop the grid's accent border. The
// grid has no per-column header alignment prop; the design right-aligns the
// Dilution, Raw and Result headings.
const designOverrides = `
.v3-importmap .grid-cell:not([aria-colindex="6"]) > span { position: relative; top: -1px; }
.v3-importmap .after-hidden-row { border-top: 0 !important; }
.v3-importmap .column-header[aria-label^="C "],
.v3-importmap .column-header[aria-label^="D "],
.v3-importmap .column-header[aria-label^="E "] { justify-content: flex-end; }
`;

const render = (theme: "light" | "dark") => (
  <div className="v3-importmap" style={{ width: "100%", height: "100%" }}>
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
        scroll: { top: (firstRow - 1) * 28, left: 0 },
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
        datasetId: "import-map",
        fields: headers.map(([id, label], column) => ({
          id,
          label,
          column,
          writable: false,
        })),
      }}
      // Rows 112's Raw/OD and Result are invalid (danger wash + corner mark).
      cellState={(row, column) => (row === 111 && (column === 3 || column === 4) ? "invalid" : undefined)}
      renderCell={({ point, display }) => {
        // The design sets Sample in the mono face at 12px.
        if (point.column === 0) return <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{display}</span>;
        // The Outcome column carries a status dot and, for flagged/control
        // rows, a tinted label.
        const outcome = outcomes[point.row];
        if (point.column === 5 && outcome) {
          const dotColor = DOT_COLOR[outcome.dot];
          return (
            <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", color: outcome.color }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", marginRight: 6, verticalAlign: 1, background: dotColor, flex: "0 0 auto" }} />
              {display}
            </span>
          );
        }
        return undefined;
      }}
    />
  </div>
);

export default { width: 839, height: 169, render } satisfies V3FixtureModule;
