/**
 * COMP-04.3 visual fixture: the v3 `FilterBuilder` popover, rendered from the
 * States screen's own two conditions under `themes/v3.css`, for comparison with
 * a crop of the ELN design render (`canvas/States.dc.html`, "Filter builder").
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";
import "@sheetbase-labs/sheetbase-shared/shell.css";
import "./styles.css";
import { FilterBuilder } from "./FilterBuilder";
import { FilterChips } from "./FilterChips";
import type { FilterBuilderFieldInput } from "./FilterBuilder";
import { buildPredicate, parseSearchQuery, type FieldOption, type GroupNode, type SheetbaseField } from "@sheetbase-labs/sheetbase-shared";

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

/**
 * `?scene=groups`: the grouped builder with a None of group, its chips, a
 * search box with query syntax, async project options and a server-style count.
 * The default scene stays the States popover the visual spec compares.
 */
const PROJECTS: FieldOption[] = [
  { value: "p-aav8", label: "AAV8 TFF" },
  { value: "p-mab", label: "mAb polish step" },
  { value: "p-lnp", label: "LNP screen" },
];
const GROUP_FIELDS: SheetbaseField[] = [
  { id: "status", label: "Status", dataType: "text", options: ["Approved", "In review", "Draft"] },
  { id: "project", label: "Project", dataType: "relationship", loadOptions: async (q) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return PROJECTS.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()) || p.value === q);
  } },
  { id: "osmolality", label: "Osmolality", dataType: "number" },
];
const ROWS = [
  { status: "Approved", project: "p-aav8", osmolality: 290 },
  { status: "In review", project: "p-aav8", osmolality: 310 },
  { status: "Approved", project: "p-mab", osmolality: 280 },
  { status: "Draft", project: "p-lnp", osmolality: 340 },
  { status: "In review", project: "p-lnp", osmolality: 295 },
];
const groupsNode: GroupNode = {
  type: "group",
  id: "root",
  combinator: "AND",
  children: [
    { type: "condition", id: "c1", field: "status", operator: "in", value: ["Approved", "In review"] },
    { type: "group", id: "g1", combinator: "NOT", children: [{ type: "condition", id: "c2", field: "project", operator: "eq", value: "p-aav8" }] },
  ],
};

function GroupsScene() {
  const [node, setNode] = React.useState<GroupNode>(groupsNode);
  const [draft, setDraft] = React.useState<GroupNode>(groupsNode);
  const [focus, setFocus] = React.useState<string | undefined>();
  const [box, setBox] = React.useState('buffer status:approved,"in review" -project:p-aav8 osmolality:>285');
  const parsed = parseSearchQuery(box, GROUP_FIELDS);
  const count = ROWS.filter(buildPredicate(draft)).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, width: 380 }}>
      <input aria-label="Search" value={box} onChange={(e) => setBox(e.target.value)} style={{ height: 28, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }} />
      <div className="sb-muted" style={{ fontSize: 12 }} data-testid="parsed">text: {parsed.text || "—"} · {parsed.filter.children.length} filters</div>
      <FilterChips node={node} fields={GROUP_FIELDS} onRemove={() => {}} onEdit={setFocus} onAdd={() => {}} />
      <FilterBuilder node={node} fields={GROUP_FIELDS} onChange={setDraft} onApply={(n) => setNode(n)} matchCount={count} focusId={focus} />
    </div>
  );
}

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
          // The States canvas asks for `Inter` / `JetBrains Mono` and the
          // design-reference renderer answers those from the same @fontsource
          // packages imported above, so the baseline rasterises the real faces.
          // Pin the fontsource family names (`Inter` / `JetBrains Mono` name
          // the same files on the canvas).
          "--font-sans": '"Inter Variable", system-ui, sans-serif',
          "--font-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
        } as React.CSSProperties
      }
    >
      {new URLSearchParams(window.location.search).get("scene") === "groups" ? (
        <GroupsScene />
      ) : (
        <FilterBuilder fields={fields} node={node} />
      )}
    </div>
  </React.StrictMode>,
);
