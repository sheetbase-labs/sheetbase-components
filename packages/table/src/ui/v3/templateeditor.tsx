/**
 * COMP-02.6 visual fixture: the Template TPL-006 column editor ("Clarification
 * runs", a record-list section of the depth-filter clarification template).
 *
 * Crop box (TemplateEditor renders, 1440×1000, scale 1): x=506 y=195 w=604
 * h=410 — the design's bordered wrapper (`border: 1px solid var(--border);
 * border-radius: 6px; overflow: hidden`, 608px content wide) from its top-left
 * border to the bottom border. The wrapper's right border and the last few px
 * of the Rule column sit outside the 604px crop.
 *
 * The design's table is `class="t num"`: a plain record list with no row-number
 * gutter, a 31px header (32px block with its border) and per-row heights driven
 * by wrapped two-line cells (49px; the single-line Load row is 33px). Source
 * cells carry the v3 provenance badges (dataset/record/ƒx) and the Max ΔP
 * column carries the "v5" added-tag; all are rendered through `renderCell`.
 *
 * Columns, widths, wrap points, badges and states come from
 * `canvas/TemplateEditor.dc.html` and the live DOM of `TemplateEditor-light.png`.
 */
import type { CSSProperties } from "react";
import { RangeStore } from "../../engine/range-store";
import type { CellFormat } from "../../engine/types";
import { Spreadsheet, type DatasetFieldHeader } from "../Spreadsheet";
import type { V3FixtureModule } from "./types";

const headers: readonly string[] = ["Column", "Source", "Type", "Unit", "Required", "Rule"];

const widths = [90.797, 155.063, 122.266, 58.813, 71.203, 109.859];
const rowHeights = [49, 49, 33, 49, 49, 49, 49, 49];

type SourceKind = "dataset" | "record" | "calc";
const sources: readonly { kind: SourceKind; label: string }[] = [
  { kind: "dataset", label: "Model Clarification run" },
  { kind: "record", label: "Material lot" },
  { kind: "dataset", label: "Model Clarification run" },
  { kind: "dataset", label: "Model ELISA and turbidity" },
  { kind: "dataset", label: "Model ELISA and turbidity" },
  { kind: "calc", label: "ƒx" },
  { kind: "calc", label: "ƒx" },
  { kind: "calc", label: "ƒx" },
];

// Wrap points are the design's own line breaks (the canvas sets
// `white-space: normal; line-height: 17px` on the record cells); a "\n" makes
// the grid's `.multiline` cell render the same two lines at the fixed row
// height.
const rows: readonly (readonly string[])[] = [
  ["Condition", "Model Clarification run", "Text", "—", "Yes", "Unique in\nsheet"],
  ["Filter train", "Material lot", "Record link", "—", "Yes", "Status is\nReleased"],
  ["Load", "Model Clarification run", "Number, 0 dp", "L/m²", "Yes", "10–300"],
  ["Turbidity\nout", "Model ELISA and turbidity", "Number, 1 dp", "NTU", "Yes", "0–50, else out\nof range"],
  ["Capsid\ntitre", "Model ELISA and turbidity", "Number, sci.", "cp/mL", "Yes", "—"],
  ["Step yield", "ƒx", "= titre out ÷ titre\nin", "%", "—", "—"],
  ["Meets\ncriteria", "ƒx", "Turbidity ≤ 20\nand yield ≥ 80", "—", "—", "—"],
  ["Max ΔP", "ƒx", "= max of\nPressure and ΔP", "bar", "—", "≤ 1.5"],
];

const data = new Map<string, string>();
rows.forEach((row, rowIndex) => {
  row.forEach((value, column) => {
    data.set(`${String.fromCharCode(65 + column)}${rowIndex + 1}`, value);
  });
});

// The three v3 source glyphs, copied from the design's inline SVG.
const SourceIcon = ({ kind }: { kind: SourceKind }) => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "dataset" && (
      <>
        <ellipse cx="8" cy="4" rx="5" ry="1.8" />
        <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
      </>
    )}
    {kind === "record" && <path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" />}
    {kind === "calc" && <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" />}
  </svg>
);

// The design's `.tag.add` (bundle.css) — the component library has no tag
// class, so the v5 pill is styled from the same v3 tokens.
const tagStyle: CSSProperties = {
  background: "var(--green-soft)",
  color: "var(--green-text)",
  fontSize: 11,
  fontWeight: 500,
  lineHeight: "14px",
  padding: "1px 6px",
  borderRadius: "var(--radius-sm)",
};

const render = (theme: "light" | "dark") => (
  <>
    {/* The design's record table pads its `th` 10px, but the v3 grid theme's
        header padding is 8px and the grid exposes no per-header override. The
        fixture is the only tenant of `#grid-fixture`, so scope the design
        metric there. */}
    <style>{"#grid-fixture .spreadsheet { --grid-header-padding-x: 10px; }"}</style>
    <Spreadsheet
      theme={theme}
      readOnly
      initialData={data}
      initialState={{
        data,
        formats: new RangeStore<CellFormat>(),
        columnWidths: widths,
        rowHeights: [...rowHeights, 0],
        // The design shows no active cell; park the selection on the zero-height
        // row below the list so its outline stays out of the crop.
        selection: { anchor: { row: 8, column: 0 }, focus: { row: 8, column: 0 } },
        scroll: { top: 0, left: 0 },
        frozenRows: 0,
        frozenColumns: 0,
      }}
      rowCount={rowHeights.length + 1}
      columnCount={headers.length}
      // The design's `th` is 31px of content plus its 1px bottom border, and the
      // grid's header cell is border-box, so the block is 32px.
      headerHeight={32}
      defaultRowHeight={33}
      rowHeaderWidth={0}
      fieldColumns={new Set(headers.map((_, index) => index))}
      datasetHeader={{
        datasetId: "tpl-006-clarification-runs",
        fields: headers.map((label, column): DatasetFieldHeader => ({ id: `col-${column}`, label, column, writable: false })),
      }}
      // The design's "= titre out ÷ titre in" / "= max of Pressure and ΔP" are
      // descriptive copy, not live formulas: keep "=" as inert text (and skip
      // the formula-value colour the default cell would paint).
      calculationAuthority="host"
      renderCell={({ point, display }) => {
        if (point.column === 1) {
          const source = sources[point.row];
          if (!source) return undefined;
          return (
            <span className={`src ${source.kind}`} style={{ paddingLeft: 2, position: "relative", top: -1 }}>
              <SourceIcon kind={source.kind} />
              {source.label}
            </span>
          );
        }
        // The design's record cells pad 10px (the v3 grid default is 8px) and the
        // Column column pads 12px; the extra offset restores the design metrics.
        const paddingLeft = point.column === 0 ? 4 : 2;
        const multiline = display.includes("\n");
        if (point.column === 0 && point.row === 7) {
          return (
            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2, paddingLeft }}>
              Max ΔP
              <span style={tagStyle}>v5</span>
            </span>
          );
        }
        // Single-line cells centre 1px lower than the design's top-aligned 17px
        // line box; wrapped cells land half a pixel lower still.
        return <span className={multiline ? "multiline" : undefined} style={{ paddingLeft, position: "relative", top: multiline ? -0.5 : -1 }}>{display}</span>;
      }}
    />
  </>
);

export default { width: 604, height: 410, render } satisfies V3FixtureModule;
