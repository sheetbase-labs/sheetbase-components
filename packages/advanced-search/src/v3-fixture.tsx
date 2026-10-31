/**
 * COMP-04.3 fixture: the v3 `FilterBuilder` under `themes/v3.css`. The default
 * scene is the popover card with the States screen's two conditions;
 * `?scene=rules` is the inline rule builder (reference layout) and
 * `?scene=groups` the grouped one.
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

/**
 * `?scene=rules`: the inline rule builder as the reference lays it out: two
 * rows under And, then a three-condition Or group with a multi-value Any of.
 * `?width=420` renders it in a narrow host to show the wrapped rows.
 */
const RULE_FIELDS: SheetbaseField[] = [
  { id: "seniority", label: "Seniority", dataType: "text", options: ["Manager", "Director", "Analyst"] },
  { id: "type", label: "Expense type", dataType: "text", options: ["Food & drink", "Travel", "Lodging", "Software"] },
  { id: "merchant", label: "Merchant", dataType: "text", options: ["Uber", "Delta", "Hilton"] },
  { id: "currency", label: "Currency", dataType: "text", options: ["USD", "EUR", "GBP"] },
];
const rulesNode: GroupNode = {
  type: "group",
  id: "root",
  combinator: "AND",
  children: [
    { type: "condition", id: "r1", field: "seniority", operator: "eq", value: "Manager" },
    { type: "condition", id: "r2", field: "currency", operator: "neq", value: "GBP" },
    {
      type: "group",
      id: "g1",
      combinator: "OR",
      children: [
        { type: "condition", id: "r3", field: "type", operator: "in", value: ["Food & drink", "Travel"] },
        { type: "condition", id: "r4", field: "merchant", operator: "eq", value: "Uber" },
        { type: "condition", id: "r5", field: "currency", operator: "eq", value: "USD" },
      ],
    },
  ],
};

function RulesScene() {
  const width = Number(new URLSearchParams(window.location.search).get("width")) || 900;
  const [draft, setDraft] = React.useState<GroupNode>(rulesNode);
  return (
    <div style={{ padding: 24, width }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", marginBottom: 12 }}>WHEN</div>
      <FilterBuilder variant="inline" node={rulesNode} fields={RULE_FIELDS} onChange={setDraft} matchCount={draft.children.length * 7} />
    </div>
  );
}

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";

const scene = new URLSearchParams(window.location.search).get("scene");

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
      {scene === "rules" ? (
        <RulesScene />
      ) : scene === "groups" ? (
        <GroupsScene />
      ) : (
        <FilterBuilder fields={fields} node={node} />
      )}
    </div>
  </React.StrictMode>,
);
