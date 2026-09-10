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
import "sheetbase-shared/panes.css";
```

## Panes

`SheetbaseShell` is the shared application frame (topbar / subbar / body) built
from the same `.sb-frame` primitives every component uses. `PaneLayout` is a
nestable multiplexer: panes tile into resizable splits and tabbed stacks. Grab
a tabbed pane by its tab, or a lone pane by the empty chrome of its own top
bar, then drop on another pane's edge to split or its centre to tab them
together.

```tsx
<SheetbaseShell theme={theme} onToggleTheme={toggleTheme}>
  <PaneLayout panes={panes} defaultLayout={layout} onLayoutChange={setLayout} />
</SheetbaseShell>
```

Outside a `SheetbaseShell` (or any `.sheetbase-scope`), pass `theme` so the pane
chrome — splitter, tabs, drag preview and drop zones — resolves its tokens.

Pane content renders through stable portals, so moving a pane between stacks or
tabs keeps its component state.

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
