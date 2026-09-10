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
stack does render a lightweight tab row above the component, so a component that
also draws its own topbar shows both; pass `frame={false}` where a component
supports it (table surface, explorer) when you want the tab row to be the only
chrome.

Pass `theme` when PaneLayout is not already inside a `.sheetbase-scope` so pane
chrome — splitter, tabs, drag preview and drop zones — resolves its tokens.
`SheetbaseShell` remains available for hosts that want the shared topbar/subbar
frame around a layout.

Pane content renders through stable portals, so moving a pane between stacks or
tabs keeps its component state. Panes nest: a component can host its own
`PaneLayout`, and each layout only handles its own drags. Set `dragHandle` on a
pane to start drags from the component top bar (default), an inner
`.sb-panel-heading`, or nowhere.

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

See the repository README for the vocabulary (`text` not `string`, `isNull` not
`isEmpty`, `relationship` not `relation`).
