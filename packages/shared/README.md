# @sheetbase-labs/sheetbase-shared

Canonical Sheetbase field, query and chrome primitives.

```ts
import {
  operatorsForField,
  testCondition,
  toFilterClause,
  toFieldDataType,
  PaneLayout,
  SheetbaseShell,
} from "@sheetbase-labs/sheetbase-shared";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/shell.css";
// PaneLayout owns its styles: panes.css ships with the import above.
```

## Theming

Every package reads its colours, fonts and sizes from CSS custom properties declared on the `.sheetbase-scope` / `.sheetbase-explorer` wrapper, so a host can retheme without forking. `@sheetbase-labs/sheetbase-shared/theme.css` is the default preset (the packages' own look); `@sheetbase-labs/sheetbase-shared/themes/v3.css` is the UI system v3 preset whose values are the design tokens verbatim.

```ts
import "@sheetbase-labs/sheetbase-shared/theme.css";       // default preset
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";   // v3 preset — load after the default
```

Add `data-theme="dark"` (or the `.dark` class) on the scope for the dark set. The scope element carries both the light default and the dark override, so a nested component replies to the nearest scope's theme.

### Mapping a host's tokens

A host that already has its own tokens does not need to copy values: point the package variables at the host variables on the same scope. The ELN, for example, maps its `--its-*` tokens onto the `--sb-*`/package names:

```css
/* host.css — loaded after the preset, on the host's scope element */
:where(.sheetbase-scope),
:where(.sheetbase-explorer) {
  --panel: var(--its-surface);
  --panel-2: var(--its-surface-muted);
  --text: var(--its-text);
  --muted: var(--its-text-muted);
  --border: var(--its-border);
  --accent: var(--its-accent);
  --selection: var(--its-selection);
  --font-sans: var(--its-font-sans);
  --text-size: var(--its-text-size);
  /* … */
}
```

Any variable may be overridden this way; the full set begins in `src/theme.css`. Besides the surface/border/text/accent variables, the set includes status marks (`--green`, `--orange`, `--blue`, `--purple`, `--danger`), chart tokens (`--series-a/b/c`, `--chart-grid`, `--chart-axis`, `--chart-label`, `--chart-anchor`), direct-formatting swatches (`--format-colour-1..10`), formula-reference outlines (`--ref-1..4`), the explorer series palettes (`--palette-<kind>-1..6`), `--on-accent` for text on an accent fill, and the shape/height tokens (`--radius-*`, `--row-height`, `--control-height`).

Most components consume a variable through CSS or inline styles, which resolve `var()` directly. Two targets cannot — SVG presentation attributes (the chart renderer) and `<input type="color">` — so those call the exported `resolveThemeColour` / `resolveThemeColours` helpers, which read the computed colour from the live scope element.

## Panes

`PaneLayout` is a nestable multiplexer: panes tile into resizable splits and tabbed stacks. Grab a tabbed pane by its tab, or a lone pane by the empty chrome of its own top bar, then drop on another pane's edge to split or its centre to tab them together.

```tsx
<PaneLayout panes={panes} defaultLayout={layout} onLayoutChange={setLayout} theme={theme} />
```

Panes add no surface of their own — the component frame is the surface. A tabbed stack renders a segmented tab row as multiplexer chrome on the stack background; each component keeps its own top bar inside its plate. Host-level actions (`PaneSpec.actions`) sit on the tab row next to the pane menu and close button. Hosts that prefer a single merged bar can still set `chrome="none"` on schema/rules/search and re-home their controls through `PaneSpec.actions` (backed by the components' imperative handles).

For one app surface around the whole layout instead of one per component, pass `surface="shared"` and wrap the layout in a host frame such as `<SheetbaseShell header={false}>`. PaneLayout then neutralises each nested component's outer app frame, so only their inner panels show.

Pass `theme` when PaneLayout is not already inside a `.sheetbase-scope` so pane chrome — splitter, tabs, drag preview and drop zones — resolves its tokens. `SheetbaseShell` remains available for hosts that want the shared topbar/subbar frame around a layout.

Theme ownership: passing a controlled `theme` to schema/rules/search/explorer hides their built-in toggle, so a host can own a single theme control instead of several synchronised ones.

Pane content renders through stable portals, so moving a pane between stacks or tabs keeps its component state. Panes nest: a component can host its own `PaneLayout`, and each layout only handles its own drags. Set `dragHandle` on a pane to start drags from the component top bar (default), an inner `.sb-panel-heading`, or nowhere.

### Tabs

A `StackNode` holds one or more pane ids; more ids = more tabs. Add them:

- **Declarative:** `{ kind: "stack", panes: ["schema", "rules", "search"], active: "schema" }`.
- **Pure helpers:** `addPaneToStack`, `movePane(..., "center")`, `setActivePane`, `reorderStack`.
- **Imperative handle:** `ref` gives `getLayout`, `setLayout`, `tabInto`, `movePane`, `addPane`, `activate`, `close`.

```tsx
const panes = useRef<PaneLayoutHandle>(null);
<PaneLayout ref={panes} panes={panes} ... />
panes.current?.tabInto("search", "analysis");   // tab Search into the analysis stack
panes.current?.addPane("search", "analysis");   // place a pane the host just added to `panes`
```

A pane the host adds to `panes` at runtime must also be placed (`addPane`), because PaneLayout only auto-adds missing panes at load.

The pane actions menu (`paneMenu`: `"head"` default, `"hover"` for lone panes, `"off"`) lists the other stacks under **Tab with** and a host **New pane…** action (`onRequestNewPane`).

Drag semantics: dropping a pane on another pane's **body or edge** splits out a new pane; dropping it on a **tab or tab strip** adds it as a tab. Within its own group, dropping on a tab reorders and dropping on the body pops the pane out. The pane menu's **Tab with** does the same as a tab-strip drop; **Split into pane**, `Alt`+`Shift`+`↑`/`↓`, `splitPaneOut` and the handle's `splitOut` do the same as pop-out.

### Keyboard

- Tab strip: `Left`/`Right`/`Home`/`End` move and activate, `Alt`+`Shift`+`Left`/`Right` reorder, `Delete` closes.
- Focused pane: `Alt`+arrow joins the nearest stack in that direction, `Alt`+`Shift`+arrow pulls the pane out into a split, `Delete` closes.
- Splitters: arrow keys resize.

### Persistence

Persistence is a versioned `PaneLayoutState` (`{ version, layout }`). Saves happen for controlled and uncontrolled layouts; loads apply when uncontrolled, so a controlled host loads its own initial state with `loadPaneLayoutState`. Loading reconciles against the current `panes` — unknown panes are dropped and new ones appended — so stored layouts survive pane-set changes. The pure operations in `layout.ts` (`movePane`, `removePane`, `splitStack`, …) can be used without React.

## Filter trees in `DatasetQuery`

`DatasetQuery` carries an optional `filterTree?: GroupNode` alongside the flat `filters`/`filterLogic`/`sort` fields. The flat fields remain the fast path; when `filterTree` is present it is **authoritative** — it exists precisely because the flat shape cannot express nested groups or `NOT`.

```ts
type ConditionNode = { type: "condition"; id: string; field: string; operator: FilterOperator; value?: unknown };
type GroupNode     = { type: "group"; id: string; combinator: "AND" | "OR" | "NOT"; children: FilterNode[] };
type FilterNode    = ConditionNode | GroupNode;
```

Semantics follow `buildPredicate`: `AND` = every child, `OR` = some child, `NOT` = *no* child matches (NOR). `toDatasetQuery(node, sort?)` is the emission helper: it returns the flat query when the tree flattens losslessly and a `{ filterTree, sort }` query otherwise — never `undefined`, so a nested search can no longer be mistaken for "clear the filter".

Transport: `PageRequest.filterTree` mirrors the field; `HttpPagedDataAdapter` serialises it as a `?filterTree=<json>` query param (the flat fields keep their existing params). `createMemoryPagedAdapter` and `examples/million-row-api.ts` evaluate it via `buildPredicate`.

Cache identity: `queryKey` folds the tree in through `canonicalFilterTree`, which strips node `id`s — they are session-random, so canonicalisation is by structure (combinator, fields, operators, values, child order), not identity.

Tree editing: `andCondition(root, condition)` appends a condition under an AND root (wrapping OR/NOT roots so the tree stays intact), and `withoutCondition(root, { field, operator, value })` removes matching root-level conditions by serialised-value equality, returning `root` unchanged when nothing matched — the referential compare doubles as a containment check. The explorer uses both for chart-click cross-filtering.

Search box syntax: `parseSearchQuery(input, fields)` returns `{ text, filter }` — `key:value`, `key:"two words"`, `-key:value` (NOT, as a one-child NOT group), `key:a,b` (in), `key:>5` / `key:<2026-10-01`, `key:1..5` (between), `key:=exact` — and `formatSearchQuery` is the inverse. Keys match a field's id or label ignoring case; unknown keys, quoted phrases, `-word` and `OR` stay in `text` verbatim for the server's `websearch_to_tsquery`. `SheetbaseField.loadOptions(query)` supplies options on demand for fields too large to list.

**Executor obligations**: if you receive a `filterTree` you cannot evaluate, say so — echo it in `DatasetPage.request` and/or surface an error — never silently ignore it and return unfiltered rows. Do not evaluate the flat `filters` as a fallback: the tree is the filter, the flat clauses are not a partial equivalent. Host executors in other languages reimplement the `buildPredicate` walk; the node schema above is plain JSON.

## Workspace

`WorkspaceProvider` shares host-owned state (`fields`, `rows`, `query`) so components interact without the host wiring each pair. Components read slices with `useWorkspace`, `useWorkspaceQuery`, `useWorkspaceFields` or `useWorkspaceRows`, and report edits through their existing callbacks — e.g. `AdvancedSearch` writes `query`, a query-driven table reads it.

```tsx
<WorkspaceProvider value={{ fields, rows, query }}>
  {/* search sets query; table consumes it */}
</WorkspaceProvider>
```

For datasets too large to materialise, `useWorkbench` accepts `source: WorkspaceDataSource` instead of `rows` (exactly one is required — it throws `TypeError` otherwise). `WorkspaceDataSource` mirrors `PagedDataAdapter.fetchPage` structurally plus an optional `aggregate` twin of the explorer's remote contract. In source mode `wb.remote` is true, `viewRows`/`filteredRows` are `null` (rows aren't realised client-side), and `workspace.source` is readable via `useWorkspaceSource()`. See `docs/workbench-composition.md` for the per-pane remote dataflow.

## Studio data sources

`StudioDataSource` (`source.ts`) is the contract Sheetbase Studio explores through: a catalog of `TableInfo`s plus `page` and `aggregate`, and optionally `profile` (per-field `FieldProfile`s), `histogram` (exact bins), `sample` (seeded random rows), `sql` (read-only; registers a `query` table) and `upload`. `capabilities` says which optional parts a source offers, so the UI can explain what it can't do rather than show wrong numbers. Every request that carries a filter must apply it with `buildPredicate` semantics or reject it — the same executor obligation as `DatasetQuery.filterTree`.

The wire shapes are plain JSON, so other runtimes implement the same contract (the `sheetbase-studio` Python package does, over Ibis). `workspaceSourceFor(source, tableId)` binds one table to the workbench's `WorkspaceDataSource`. Implementations live in `@sheetbase-labs/sheetbase-studio`.

## Build

`bun run build:lib` emits `dist-lib` (ESM + bundled `style.css`) and `dist-types`. The `types` export resolves to `src` so type-checking the monorepo needs no prebuild; `import` resolves to the compiled lib. Consumers of the compiled lib must load the styles (`@sheetbase-labs/sheetbase-shared/theme.css`, `shell.css`, `panes.css`).

See the repository README for the vocabulary (`text` not `string`, `isNull` not `isEmpty`, `relationship` not `relation`).
