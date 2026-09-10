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

The layout is a plain JSON tree (`StackNode | SplitNode`), so it persists like
any other sheetbase state via `persistKey`/`adapter`. The pure operations in
`layout.ts` (`movePane`, `removePane`, `splitStack`, …) can be used without React.

See the repository README for the vocabulary (`text` not `string`, `isNull` not
`isEmpty`, `relationship` not `relation`).
