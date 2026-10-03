/**
 * COMP-03 visual fixtures: the design's step-yield and turbidity figures,
 * rendered from the design's nine-condition fixture under `themes/v3.css`, for
 * comparison with crops of the ELN design renders.
 *
 * The spec and rows mirror `lib/figure.test.ts` (the Analysis screen's nine
 * conditions, mirrored in `canvas/Notebook.dc.html` Figure 1 and
 * `canvas/Analysis.dc.html` charts 1 and 2).
 *
 * `?chart=step-yield` (default) renders the Notebook Figure 1 figure at its
 * natural 844×262 size. `?chart=turbidity` renders the Analysis chart 2 figure
 * at its natural 844×196 geometry, CSS-sized to the 640×149 box the Analysis
 * canvas displays it in (so the same viewBox is scaled 640/844, exactly as the
 * design render does).
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";
import "@sheetbase-labs/sheetbase-shared/shell.css";
import "./styles.css";
import "./figure.css";
import { Chart } from "./Chart";
import type { ChartSpec, Dataset } from "./lib/types";

const rows = [
  { Condition: "A-50", Train: "Train A", Load: 50, Turbidity: 6.2, StepYield: 86.0, Flagged: false },
  { Condition: "A-100", Train: "Train A", Load: 100, Turbidity: 9.8, StepYield: 82.6, Flagged: false },
  { Condition: "A-150", Train: "Train A", Load: 150, Turbidity: 18.4, StepYield: 75.6, Flagged: false },
  { Condition: "B-50", Train: "Train B", Load: 50, Turbidity: 4.1, StepYield: 90.7, Flagged: false },
  { Condition: "B-100", Train: "Train B", Load: 100, Turbidity: 5.6, StepYield: 88.4, Flagged: false },
  { Condition: "B-150", Train: "Train B", Load: 150, Turbidity: 8.9, StepYield: 84.9, Flagged: false },
  { Condition: "C-50", Train: "Train C", Load: 50, Turbidity: 12.7, StepYield: 80.2, Flagged: false },
  { Condition: "C-100", Train: "Train C", Load: 100, Turbidity: 24.3, StepYield: 72.1, Flagged: false },
  { Condition: "C-150", Train: "Train C", Load: 150, Turbidity: 61.5, StepYield: 62.8, Flagged: true },
];

const dataset: Dataset = {
  name: "Clarification runs · EXP-0142",
  source: "fixture",
  rows,
  columns: [
    { key: "Condition", kind: "string", nullable: false, uniqueCount: 9 },
    { key: "Train", kind: "string", nullable: false, uniqueCount: 3 },
    { key: "Load", kind: "number", nullable: false, uniqueCount: 3 },
    { key: "Turbidity", kind: "number", nullable: false, uniqueCount: 9 },
    { key: "StepYield", kind: "number", nullable: false, uniqueCount: 9 },
    { key: "Flagged", kind: "boolean", nullable: false, uniqueCount: 2 },
  ],
};

/** Notebook Figure 1: step yield by load, natural 844×262. */
const stepYieldSpec: ChartSpec = {
  kind: "line",
  aggregate: "none",
  showGrid: true,
  showPoints: true,
  pointSize: 4,
  pointOpacity: 1,
  lineWidth: 1.6,
  lineOpacity: 1,
  fillOpacity: 1,
  barGap: 2,
  barRadius: 3,
  barLayout: "grouped",
  histogramBins: 12,
  palette: [],
  x: "Load",
  y: "StepYield",
  group: "Train",
  xMin: 25,
  xMax: 175,
  yMin: 60,
  yMax: 95,
  xLabel: "Load",
  xUnit: "L/m²",
  yLabel: "Step yield",
  yUnit: "%",
  refLines: [{ id: "target", axis: "y", value: 80, label: "Target ≥", unit: "%" }],
  excludeField: "Flagged",
  excludedLabel: "flagged",
};

/**
 * Analysis chart 2: turbidity by load, natural 844×196 (plot 56…824 × 20…160,
 * so the bottom padding is 36, not the figure default 42). The 20 NTU limit is
 * the reference line; C-150's flagged 61.5 sits above the 0–30 domain and the
 * figure draws it off-scale with its own `↑ 61.5` label.
 *
 * The Analysis canvas sizes its text/markers/strokes for the 0.758 display
 * scale (text 15, data label 14, markers r5, series 1.8), so the figure needs
 * the same `metrics` overrides to match the crop.
 */
const turbiditySpec: ChartSpec = {
  kind: "line",
  aggregate: "none",
  showGrid: true,
  showPoints: true,
  pointSize: 4,
  pointOpacity: 1,
  lineWidth: 1.6,
  lineOpacity: 1,
  fillOpacity: 1,
  barGap: 2,
  barRadius: 3,
  barLayout: "grouped",
  histogramBins: 12,
  palette: [],
  x: "Load",
  y: "Turbidity",
  group: "Train",
  xMin: 25,
  xMax: 175,
  yMin: 0,
  yMax: 30,
  xLabel: "Load",
  xUnit: "L/m²",
  yLabel: "Turbidity out",
  yUnit: "NTU",
  refLines: [{ id: "limit", axis: "y", value: 20, label: "Limit ≤", unit: "NTU" }],
  excludeField: "Flagged",
  metrics: { fontSize: 15, labelFontSize: 14, markerSize: 5, lineWidth: 1.8, strokeWidth: 1.6 },
};

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const chart = params.get("chart") === "turbidity" ? "turbidity" : "step-yield";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div
      className="sheetbase-scope"
      data-theme={theme}
      style={
        {
          background: "var(--surface)",
          padding: 0,
          WebkitFontSmoothing: "antialiased",
          // The canvas asks for `Inter, sans-serif`; the design render resolves
          // that to the generic `sans-serif` (Helvetica in the render's
          // Chromium), not `system-ui`. Pin `sans-serif` so the fixture matches
          // the baseline: measured on the step-yield crop this is 0.44% vs
          // 1.21% for `system-ui`.
          "--font-sans": "sans-serif",
        } as React.CSSProperties
      }
    >
      {chart === "turbidity" ? (
        <div className="fixture-turbidity">
          <Chart
            dataset={dataset}
            spec={turbiditySpec}
            width={844}
            height={196}
            padding={{ top: 20, right: 20, bottom: 36, left: 56 }}
            showYAxisTitle={false}
            legend="none"
          />
        </div>
      ) : (
        <Chart dataset={dataset} spec={stepYieldSpec} legend="none" />
      )}
    </div>
  </React.StrictMode>,
);
