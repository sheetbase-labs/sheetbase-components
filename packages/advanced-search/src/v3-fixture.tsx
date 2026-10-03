/**
 * COMP-04.3 visual fixture: the v3 `FilterBuilder` popover, rendered from the
 * States screen's own two conditions under `themes/v3.css`, for comparison with
 * a crop of the ELN design render (`canvas/States.dc.html`, "Filter builder").
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";
import "@sheetbase-labs/sheetbase-shared/shell.css";
import "./styles.css";
import { FilterBuilder } from "./FilterBuilder";
import type { FilterBuilderFieldInput } from "./FilterBuilder";
import type { GroupNode } from "@sheetbase-labs/sheetbase-shared";

const fields: FilterBuilderFieldInput[] = [
  { id: "status", label: "Status", dataType: "text", options: ["In progress", "Complete", "Review"] },
  { id: "owner", label: "Owner", dataType: "text", options: ["Me", "Sam Patel", "Priya S."] },
];

const node: GroupNode = {
  type: "group",
  id: "root",
  combinator: "AND",
  children: [
    { type: "condition", id: "c1", field: "status", operator: "eq", value: "In progress" },
    { type: "condition", id: "c2", field: "owner", operator: "eq", value: "Me" },
  ],
};

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";

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
          // The design reference (sheetbase-eln/scripts/design-reference.mts)
          // rasterises the popover text in the platform UI font, not the
          // canvas's `Inter` — its fontsource `Inter` never reaches the string.
          // The fixture pins `system-ui` so it matches the baseline render
          // rather than a different Inter build.
          "--font-sans": "system-ui, sans-serif",
        } as React.CSSProperties
      }
    >
      <FilterBuilder fields={fields} node={node} />
    </div>
  </React.StrictMode>,
);
