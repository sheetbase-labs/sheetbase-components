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
stack renders a lightweight tab row; set `chrome="none"` on schema/rules/search
and re-home their actions through `PaneSpec.actions` (backed by the components'
imperative handles) so the pane bar is the only chrome.

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
action (`onRequestNewPane`). Dragging a tab onto another pane's centre also tabs
them together.

To turn a tab back into its own pane, drag it onto its own pane (or another
pane's edge), use **Split into pane** in the menu, press `Alt`+`Shift`+`↑`/`↓`
on a tab, or call `splitPaneOut` / the handle's `splitOut(paneId, direction)`.

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

## Build

`bun run build:lib` emits `dist-lib` (ESM + bundled `style.css`) and
`dist-types`. The `types` export resolves to `src` so type-checking the
monorepo needs no prebuild; `import` resolves to the compiled lib. Consumers of
the compiled lib must load the styles (`sheetbase-shared/theme.css`,
`shell.css`, `panes.css`).

See the repository README for the vocabulary (`text` not `string`, `isNull` not
`isEmpty`, `relationship` not `relation`).
