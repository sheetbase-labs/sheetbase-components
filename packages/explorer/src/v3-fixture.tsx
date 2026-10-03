/**
 * COMP-03 visual fixture: the Notebook Figure 1 step-yield chart, rendered from
 * the design's nine-condition fixture under `themes/v3.css` at the design's own
 * 844×262 figure size, for comparison with a crop of the ELN design render.
 *
 * The spec and rows mirror `lib/figure.test.ts` (the Analysis screen's nine
 * conditions, mirrored in `canvas/Notebook.dc.html` Figure 1).
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

const baseSpec: ChartSpec = {
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

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div
      className="sheetbase-scope"
      data-theme={theme}
      style={{ background: "var(--surface)", padding: 0, WebkitFontSmoothing: "antialiased" }}
    >
      <Chart dataset={dataset} spec={baseSpec} legend="none" />
    </div>
  </React.StrictMode>,
);
