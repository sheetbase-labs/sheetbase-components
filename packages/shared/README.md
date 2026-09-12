# sheetbase-shared

Canonical Sheetbase field, query and chrome primitives.

```ts
import {
  operatorsForField,
  testCondition,
  toFilterClause,
  toFieldDataType,
  PaneLayout,
  SheetbaseShell,
} from "sheetbase-shared";
import "sheetbase-shared/theme.css";
import "sheetbase-shared/shell.css";
// PaneLayout owns its styles: panes.css ships with the import above.
```

## Panes

`PaneLayout` is a nestable multiplexer: panes tile into resizable splits and
tabbed stacks. Grab a tabbed pane by its tab, or a lone pane by the empty chrome
of its own top bar, then drop on another pane's edge to split or its centre to
tab them together.

```tsx
<PaneLayout panes={panes} defaultLayout={layout} onLayoutChange={setLayout} theme={theme} />
```

Panes add no surface of their own — the component frame is the surface. A tabbed
stack renders a segmented tab row as multiplexer chrome on the stack background;
each component keeps its own top bar inside its plate. Host-level actions
(`PaneSpec.actions`) sit on the tab row next to the pane menu and close button.
Hosts that prefer a single merged bar can still set `chrome="none"` on
schema/rules/search and re-home their controls through `PaneSpec.actions`
(backed by the components' imperative handles).

For one app surface around the whole layout instead of one per component, pass
`surface="shared"` and wrap the layout in a host frame such as
`<SheetbaseShell header={false}>`. PaneLayout then neutralises each nested
component's outer app frame, so only their inner panels show.

Pass `theme` when PaneLayout is not already inside a `.sheetbase-scope` so pane
chrome — splitter, tabs, drag preview and drop zones — resolves its tokens.
`SheetbaseShell` remains available for hosts that want the shared topbar/subbar
frame around a layout.

Theme ownership: passing a controlled `theme` to schema/rules/search/explorer
hides their built-in toggle, so a host can own a single theme control instead of
several synchronised ones.

Pane content renders through stable portals, so moving a pane between stacks or
tabs keeps its component state. Panes nest: a component can host its own
`PaneLayout`, and each layout only handles its own drags. Set `dragHandle` on a
pane to start drags from the component top bar (default), an inner
`.sb-panel-heading`, or nowhere.

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

A pane the host adds to `panes` at runtime must also be placed (`addPane`), because
PaneLayout only auto-adds missing panes at load.

The pane actions menu (`paneMenu`: `"head"` default, `"hover"` for lone panes,
`"off"`) lists the other stacks under **Tab with** and a host **New pane…**
action (`onRequestNewPane`).

Drag semantics: dropping a pane on another pane's **body or edge** splits out a
new pane; dropping it on a **tab or tab strip** adds it as a tab. Within its own
group, dropping on a tab reorders and dropping on the body pops the pane out.
The pane menu's **Tab with** does the same as a tab-strip drop; **Split into
pane**, `Alt`+`Shift`+`↑`/`↓`, `splitPaneOut` and the handle's `splitOut` do the
same as pop-out.

### Keyboard

- Tab strip: `Left`/`Right`/`Home`/`End` move and activate, `Alt`+`Shift`+`Left`/`Right` reorder, `Delete` closes.
- Focused pane: `Alt`+arrow joins the nearest stack in that direction, `Alt`+`Shift`+arrow pulls the pane out into a split, `Delete` closes.
- Splitters: arrow keys resize.

### Persistence

Persistence is a versioned `PaneLayoutState` (`{ version, layout }`). Saves
happen for controlled and uncontrolled layouts; loads apply when uncontrolled,
so a controlled host loads its own initial state with `loadPaneLayoutState`.
Loading reconciles against the current `panes` — unknown panes are dropped and
new ones appended — so stored layouts survive pane-set changes. The pure
operations in `layout.ts` (`movePane`, `removePane`, `splitStack`, …) can be
used without React.

## Filter trees in `DatasetQuery`

`DatasetQuery` carries an optional `filterTree?: GroupNode` alongside the flat
`filters`/`filterLogic`/`sort` fields. The flat fields remain the fast path;
when `filterTree` is present it is **authoritative** — it exists precisely
because the flat shape cannot express nested groups or `NOT`.

```ts
type ConditionNode = { type: "condition"; id: string; field: string; operator: FilterOperator; value?: unknown };
type GroupNode     = { type: "group"; id: string; combinator: "AND" | "OR" | "NOT"; children: FilterNode[] };
type FilterNode    = ConditionNode | GroupNode;
```

Semantics follow `buildPredicate`: `AND` = every child, `OR` = some child,
`NOT` = *no* child matches (NOR). `toDatasetQuery(node, sort?)` is the emission
helper: it returns the flat query when the tree flattens losslessly and a
`{ filterTree, sort }` query otherwise — never `undefined`, so a nested search
can no longer be mistaken for "clear the filter".

Transport: `PageRequest.filterTree` mirrors the field; `HttpPagedDataAdapter`
serialises it as a `?filterTree=<json>` query param (the flat fields keep their
existing params). `createMemoryPagedAdapter` and `examples/million-row-api.ts`
evaluate it via `buildPredicate`.

Cache identity: `queryKey` folds the tree in through `canonicalFilterTree`,
which strips node `id`s — they are session-random, so canonicalisation is by
structure (combinator, fields, operators, values, child order), not identity.

**Executor obligations**: if you receive a `filterTree` you cannot evaluate,
say so — echo it in `DatasetPage.request` and/or surface an error — never
silently ignore it and return unfiltered rows. Do not evaluate the flat
`filters` as a fallback: the tree is the filter, the flat clauses are not a
partial equivalent. Host executors in other languages reimplement the
`buildPredicate` walk; the node schema above is plain JSON.

## Workspace

`WorkspaceProvider` shares host-owned state (`fields`, `rows`, `query`) so
components interact without the host wiring each pair. Components read slices
with `useWorkspace`, `useWorkspaceQuery`, `useWorkspaceFields` or
`useWorkspaceRows`, and report edits through their existing callbacks — e.g.
`AdvancedSearch` writes `query`, a query-driven table reads it.

```tsx
<WorkspaceProvider value={{ fields, rows, query }}>
  {/* search sets query; table consumes it */}
</WorkspaceProvider>
```

For datasets too large to materialise, `useWorkbench` accepts `source: WorkspaceDataSource`
instead of `rows` (exactly one is required — it throws `TypeError` otherwise).
`WorkspaceDataSource` mirrors `PagedDataAdapter.fetchPage` structurally plus an
optional `aggregate` twin of the explorer's remote contract. In source mode
`wb.remote` is true, `viewRows`/`filteredRows` are `null` (rows aren't
realised client-side), and `workspace.source` is readable via
`useWorkspaceSource()`. See `docs/workbench-composition.md` for the per-pane
remote dataflow.

## Build

`bun run build:lib` emits `dist-lib` (ESM + bundled `style.css`) and
`dist-types`. The `types` export resolves to `src` so type-checking the
monorepo needs no prebuild; `import` resolves to the compiled lib. Consumers of
the compiled lib must load the styles (`sheetbase-shared/theme.css`,
`shell.css`, `panes.css`).

See the repository README for the vocabulary (`text` not `string`, `isNull` not
`isEmpty`, `relationship` not `relation`).
