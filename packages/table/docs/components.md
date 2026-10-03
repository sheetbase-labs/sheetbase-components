# Table composition

The table is composed from independent UI sections. The default demo deliberately enables only the formula bar, spreadsheet and sheet bar.

```tsx
<TableLayout
  sections={{
    menuBar: false,
    toolbar: false,
    formulaBar: true,
    sidebar: false,
    statusBar: false,
    sheetBar: true,
  }}
  formulaBar={<FormulaBar {...formulaProps} />}
  table={<Spreadsheet {...spreadsheetProps} />}
  sheetBar={<SheetBar {...sheetProps} />}
/>
```

## Components

- `Spreadsheet` owns grid rendering and interactions.
- `FormulaBar` edits the active cell input or formula.
- `SheetBar` switches sheets and optionally exposes sheet creation.
- `TableLayout` composes sections without coupling them to the engine.

`TableSectionConfig` contains `menuBar`, `toolbar`, `formulaBar`, `sidebar`, `statusBar` and `sheetBar`. Notebook, dataset, embedded and full-workbook surfaces can use different configurations while sharing the same table.

The menu, toolbar, data sidebar and query status are disabled in `minimalTableSections`; they are not part of the default table surface. `notebookTableSections` drops the formula bar and sheet bar too, for a notebook block that is the grid alone.

## Grid states, the append row and the keyboard

`Spreadsheet` takes a `cellState(row, column)` callback returning one of `invalid`, `flagged`, `pending`, `derived`, `readonly`, `unsynced`, or `{ state: "conflict", count }` and `{ state: "diff", before?, after }`. Each state paints from theme variables (`styles/grid.css`): the danger wash and error mark, derived surfaces, the unsynced dotted underline and grey mark, the conflict "2 values" wash and the diff `del`/`ins` pair.

Pass `appendRow` (`true`, or `{ label }`) to render the "New run — type a condition or paste rows" row after the last populated row. Clicking it targets the first writable cell; committing that draft runs the blank-row path and calls `onRecordCreate`. `rowCount` must be large enough to hold the row.

The grid is one tab stop: arrows move between cells, Enter commits an edit and moves down, Escape discards, and Tab walks right, leaving the grid at the last column (Shift+Tab mirrors it at column 0).

## Integration modes

- `Spreadsheet` is the low-level controlled grid for local, read-only or custom persistence flows.
- `SheetbaseTable` composes formula and sheet bars around one active spreadsheet.
- `PagedSpreadsheet` adds viewport paging, system hydration, record creation and revision-aware writes.

`Spreadsheet` and `SheetbaseTable` accept `readOnly`. It blocks cell edits, clear/cut/paste, autofill, row/column insert/delete, find-and-replace, direct formatting and annotations, and hides the fill handle, replace UI and structural menu items. Selection, navigation, copy, sorting, filtering, column layout and `hydrate` stay live; the grid exposes `aria-readonly`. `SheetbaseTable` also locks the formula bar and drops sheet add/rename/delete/move while read-only. `FormulaBar` accepts `readOnly` on its own for custom compositions.

Typed dataset fields support text, number, date, boolean and relationship input. `required`, `writable`, `computed` and `options` define validation and editability independently of presentation. A `boolean` column renders its `true`/`false` values as a themed checkbox mark (`.cell-boolean`, an accessible `role="img"` with a True/False label) rather than the literal text; empty cells stay blank, a host `displayText` label wins over the mark, and the radiogroup editor is unchanged.

## Table surface and presentation state

`TableSurface` is the compact bordered work area around a table. Optional surface objects can be placed to the right or below the table and resized without becoming part of the grid renderer.

```tsx
<TableSurface
  theme={presentation.theme}
  table={<PagedSpreadsheet {...tableProps} />}
  objects={[{
    id: "conditional-formatting",
    placement: "right",
    size: 292,
    content: <ConditionalFormattingInspector {...ruleProps} />,
    onResize: (size) => updateObject({ size }),
  }]}
/>
```

`TablePresentationState` is a versioned serialisable contract containing theme, direct range formats, conditional rules and surface-object layout. The application remains the state owner. `TablePresentationAdapter` supplies persistence; `createLocalStoragePresentationAdapter` is provided for demos and local tools, while database-backed applications can implement the same `load` / `save` boundary.

`TableFormattingToolbar` consumes the selection's format summary. Uniform values render as active controls, while mixed ranges expose mixed state without enumerating every selected cell. Theme/recent colour palettes avoid host-dependent native colour controls.

Applications can replace the built-in palettes and defaults:

```tsx
<TableFormattingToolbar
  {...toolbarProps}
  colours={["#17202a", "#7652ef", "#167a59", "#fff1f1"]}
  darkColours={["#e7e5ec", "#a997ff", "#68d5ae", "#442526"]}
  defaultTextColour="#17202a"
  defaultFillColour="#ffffff"
/>
```

`darkColours` falls back to `colours` when omitted. Recently selected colours are prepended without duplicating configured values.

## Table controls

`TableControls` is the public, controlled Filters and Columns toolbar component. It owns no data; every change flows through explicit callbacks:

```tsx
<TableControls
  fields={fields}
  query={query}
  onQueryChange={setQuery}
  columns={columns}
  onColumnsChange={setColumns}
  onFrozenColumnsChange={setFrozenColumns}
  theme={theme}
/>
```

- `fields` are structural `{ id, label, dataType?, options? }` descriptions; the component derives available filter conditions from the field type.
- `query` / `onQueryChange` carry the full `DatasetQuery` (filters, filter logic, sort).
- `columns` / `onColumnsChange` carry semantic `ColumnPresentation` order, visibility and widths. Column ordering supports drag and drop; accessible up/down move buttons remain the keyboard path.
- `onFrozenColumnsChange` is optional and is only used by the reset action.

Filter conditions are typed by field: text gains `contains`/`startsWith`; numbers gain `between`; dates gain `between` and `withinLastDays`; option fields gain multi-select `in`; every type gains explicit `isNull`/`notNull`. Between clauses serialise as a two-element value array.

Both popovers render through portals (they cannot be clipped by the table wrapper), follow the shared keyboard contract — focus moves in on open, Tab wraps inside, Escape closes and restores focus to the trigger — and expose `role="dialog"` semantics with `aria-expanded`/`aria-haspopup` triggers.

## Extension points

Hosts can customise cells, editing and menus without forking the grid:

- `renderCell(context)` replaces the content of a cell. Returning `undefined` keeps the built-in rendering (including the boolean mark). The context carries `address`, `point`, `display`, `field`, `selected`, `active` and `loading`; selection, keyboard handling and write-state badges are unaffected. `display` already includes a field's `displayText` label. `address` is the stored cell address (a bound write target), while `point` is the displayed coordinate — under a local view they differ.
- `customEditors` replaces the built-in input for matched fields. `matches({ point, columnId, field })` selects the editor; `render({ point, address, columnId, field, storedValue, initialDraft, commit, cancel })` renders any input UI and calls `commit(value)` to save or `cancel()` to discard. `columnId` is the stable `fieldIds[column]` id, so record pickers and formula-reference editors can target a column by id even when it has no dataset field. `storedValue` and `address` are the stored cell's; `point` is the displayed coordinate.

```tsx
<Spreadsheet
  renderCell={({ display, field }) =>
    field?.id === "status" && display ? <StatusBadge value={display} /> : undefined}
  customEditors={[{
    matches: ({ field }) => field?.id === "colour",
    render: ({ initialDraft, commit, cancel }) => (
      <ColourPicker initial={initialDraft} onPick={commit} onCancel={cancel} />
    ),
  }]}
  {...props}
/>
```

- `contextMenuActions` appends host actions to the column and row context menus. `onSelect({ axis, index, fieldId })` receives the menu target; Escape and the arrow-key navigation treat host actions like built-in items.
- `columnMenuItems` appends host entries to the column header menu only. Both action types accept an optional `id` (used as the React key) and `disabled?(): boolean`; disabled entries are hidden.

The plain demo (`/`) uses `renderCell` for status badges and a `Copy column name` context-menu action as a working reference.

## Host hooks

A bound host (an ELN sheet, an external dataset) keeps its own data-integrity
rules in front of the grid's local commit pipeline through the seams below.
They are additive: omitting all of them preserves the current behaviour
exactly.

### Pre-commit mutation veto — `beforeCellsChange`

Runs *before* a cell mutation is applied (edit, paste, fill, clear, move,
replace, structural edit, local sort). Return `false` to reject the whole
change set — no history entry, no bound field writes, no `onMutation`; assign
to `change.next` to replace individual proposed values. A rejected single-cell
edit applies nothing and leaves the editor open.

For bulk operations the change list is the operation's full intended target set,
including cells the grid would skip; see
[Whole-operation veto for bulk writes](#whole-operation-veto-for-bulk-writes--intended-targets).

```ts
beforeCellsChange?(
  changes: SpreadsheetCellChange[],
  source: SpreadsheetMutationSource,
): boolean | void;

type SpreadsheetCellChange = {
  address: string; row: number; column: number;   // stored coordinates
  recordId?: string; fieldId?: string;            // bound identity, when known
  before?: string; next?: string;                 // previously/next stored values
  editable?: boolean;                             // false: the grid will skip it
};

type SpreadsheetMutationSource =
  | "edit" | "paste" | "fill" | "clear"
  | "move" | "replace" | "structure" | "sort" | "revert";
```

### Clipboard before-hooks — `clipboard`

`onCopy` / `onCut` / `onPaste` fire before the payload is written, cleared or
applied. Return `false` to cancel, nothing/`true` to accept, or a payload to
transform (`values` are re-parsed from replaced `text`). `onCutStatusChange`
surfaces cut status (`{ label, range }`) and `null` when the cut is dismissed,
so a host can render its own cut status.

The transform is a replacement, not just a veto — the returned payload is what
reaches the clipboard (copy/cut) or the grid (paste). A paste hook can therefore
rewrite formula relative references:

```ts
clipboard={{
  onPaste: (payload, target) => ({
    ...payload,
    text: payload.text.replace(/([A-Z]+)(\d+)/g, (_m, column, row) =>
      `${column}${Number(row) + target.row - payload.range.top}`),
  }),
}}
```

```ts
clipboard?: {
  onCopy?(payload: SpreadsheetClipboardPayload): boolean | SpreadsheetClipboardPayload | void;
  onCut?(payload: SpreadsheetClipboardPayload): boolean | SpreadsheetClipboardPayload | void;
  onPaste?(
    payload: SpreadsheetClipboardPayload,
    target: { row: number; column: number },
  ): boolean | SpreadsheetClipboardPayload | void;
  onCutStatusChange?(status: SpreadsheetCutStatus | null): void;
};

type SpreadsheetClipboardPayload = {
  text: string;                               // TSV written to / read from the clipboard
  values: readonly (readonly string[])[];     // the same content, parsed
  range: SpreadsheetClipboardRange;           // display range plus stable column ids
};
```

### Header menu hook — `columnMenuItems`

Host entries appended to the column header menu; the list is filtered through
`disabled?.()` before rendering. Use `contextMenuActions` for the row/column
context menus.

```ts
columnMenuItems?: readonly SpreadsheetMenuAction[];

type SpreadsheetMenuAction = {
  id?: string; label: string; disabled?(): boolean;
  onSelect(context: { axis: "row" | "column"; index: number; fieldId?: string }): void;
};
```

### Editor hooks — `customEditors`

The first editor whose `matches({ point, columnId, field })` is true replaces
the built-in input. `render` receives `columnId` and the cell's `storedValue`
(not the display label) alongside `initialDraft`, `commit` and `cancel` — the
hook a record picker or formula-reference editor uses.

```ts
customEditors?: readonly SpreadsheetCustomEditor[];

type SpreadsheetCustomEditor = {
  matches(context: { point: GridPoint; columnId?: string; field?: DatasetFieldHeader }): boolean;
  render(context: {
    point: GridPoint; address: string; columnId?: string; field?: DatasetFieldHeader;
    storedValue: string; initialDraft: string;
    commit(value: string): void; cancel(): void;
  }): ReactNode;
};
```

### Stored value vs display text — `DatasetFieldHeader.displayText`

A column may map its stored value to display text. The grid renders the label
while the stored value is untouched, so bound writes keep the real value (a
record id, a category key). `renderCell`'s `display` also carries the label.

```ts
type DatasetFieldHeader = {
  /* … */
  displayText?: (storedValue: string) => string | undefined;
};
```

### Sort/filter surface — `onSortChange` / `onFiltersChange`

`query` / `onQueryChange` carry the full `DatasetQuery`; these two fire only
when the sort or filter clauses actually change, and `getQuery()` on the ref
reads the live query.

```ts
onSortChange?(sorts: readonly SortClause[]): void;
onFiltersChange?(filters: readonly FilterClause[]): void;
// ref: spreadsheetRef.current?.getQuery()
```

### Local sort and filter for bound grids — `sortMode: "local"`

A bound grid (`datasetHeader.recordIdForRow`) never reorders `data`: rows are
records, so moving values between addresses would desync row→record identity.
With `sortMode: "local"` (the default) the grid instead applies the query as a
**view** — a display→source row mapping — so displayed order and hidden rows
change while every value stays with its record:

- `query.sort` orders the displayed rows (numeric-aware, `nulls` honoured,
  stable ties); `query.filters` + `filterLogic`, or the authoritative
  `filterTree`, hide rows that do not match.
- Rows with no record (`recordIdForRow` returns `undefined`) are placeholders,
  not dataset rows, so an active view shows the records that exist instead of
  thousands of empty rows.
- A query that leaves order and membership unchanged costs nothing: the grid
  keeps the identity mapping.
- Selection, editing, clipboard, fill, move, find/replace and the write path all
  operate on displayed rows and resolve each one back to its stored cell, so a
  bound write still carries the right `recordId`/`fieldId`.
- `cellState(row, column)`, `onSelectionChange.address`, `beforeCellsChange`
  changes, `onPaste`'s target and field writes report **stored** rows/addresses;
  `onSelectionChange.range` and the row numbers are displayed positions.
- Row heights, hidden rows, direct formats and conditional-format rules are
  stored against the owning row, so they travel with the record.
- `onViewportChange` reports the stored rows behind the visible window (min/max)
  so a viewport loader keeps loading what the user sees.
- `sortMode: "server"` (used by `PagedSpreadsheet`) keeps the old contract: the
  query goes to the host and no local view is applied.

The view primitives are exported for hosts and tests:
`buildGridView(config)` → `{ rows, indexOf } | undefined`, plus
`viewSourceRow`, `viewDisplayRow`, `viewCellKey`, `rowOffsetTable`,
`compareGridValues` and `compareNullable`.

### Whole-operation veto for bulk writes — `intended` targets

Handsontable's paste/fill/clear semantics are all-or-nothing: a host that must
not write partially rejects the whole operation. `beforeCellsChange` therefore
receives the operation's **full intended target set**, including cells the grid
will not write because they are not editable. Those entries carry
`editable: false`; every cell the grid will write has no `editable` field.

```ts
beforeCellsChange?(
  changes: SpreadsheetCellChange[],
  source: SpreadsheetMutationSource,
): boolean | void;

type SpreadsheetCellChange = {
  address: string; row: number; column: number;   // stored coordinates
  recordId?: string; fieldId?: string;            // bound identity, when known
  before?: string; next?: string;                 // previously/next stored values
  editable?: boolean;                             // false: the grid will skip it
};
```

Return `false` to refuse the operation as a whole — nothing is applied, no
history entry, no field writes, no `onMutation`:

```ts
beforeCellsChange: (changes) => changes.every((change) => change.editable !== false)
```

- `change.next` still replaces an individual proposed value, but only for cells
  the grid writes; a non-editable target can be vetoed, never written.
- Bulk operations (paste, fill, clear, move) report targets; a single-cell edit
  and a structural change report their applied cells only.
- A paste larger than 20,000 cells is applied in frame-sized slices, and its
  whole target set is gated once before the first slice lands.

### Structural row hooks — `onBeforeRowsInsert` / `onRowsInserted` / `onBeforeRowsRemove` / `onRowsRemoved`

The row menu and `ref.insertRows()` / `ref.deleteRows()` route through one
decision that fires these hooks. **They fire for bound grids too** — the row
menu's insert/delete entries are no longer hidden when `recordIdForRow` is set,
so a bound host's deletion preflight and persistence always run.

```ts
onBeforeRowsInsert?(rowIndex: number, count: number): boolean | void;
onRowsInserted?(rowIndex: number, count: number): void;
onBeforeRowsRemove?(rowIndex: number, count: number): boolean | void;
onRowsRemoved?(rowIndex: number, count: number): void;
```

- `rowIndex` is the **stored** row (the record), resolved through a local view;
  `count` is the number of rows acted on. Return `false` from the preflight to
  block the whole operation.
- The row menu acts on one row. A multi-row `ref.deleteRows(index, count)` under
  an active local view reports the stored row of the first displayed row and the
  displayed count; resolve records through `recordIdForRow` when a sorted or
  filtered view could make the stored span non-contiguous.
- **Unbound grid** — the mutation is applied locally (undoable) and the
  after-hook fires only when it applied.
- **Bound grid** (`datasetHeader.recordIdForRow`) — `data` is never reordered,
  so nothing is applied locally: the after-hook fires and the host persists
  (delete/create records) and pushes the rebuilt rows back through
  `replaceData`. Writes can never target the wrong record.
- Read-only grids, and a displayed row a local view hides, are no-ops.

```tsx
<Spreadsheet
  datasetHeader={header}
  onBeforeRowsRemove={(rowIndex) => canDelete(localRows[rowIndex])}
  onRowsRemoved={(rowIndex, count) => deleteRecords(localRows, rowIndex, count)}
  onRowsInserted={() => refetchRows()}
  {...props}
/>
```

## Layout, focus and the formula engine

### `height`, `stretch`, `rowHeaders`

```ts
height?: number | "fill";          // fixed px, or "fill" (height: 100%); omitted fills the layout cell
stretch?: "none" | "last" | "all"; // default "none": keep the configured widths
rowHeaders?: boolean;              // default true; false frees the row-header column
```

- `height` sets the scroll container's height inline. `"fill"` writes
  `height: 100%`, so the host's parent must be a sized box (the default
  `TableLayout` cell already is).
- `stretch` measures the scroll container and distributes slack width:
  `"last"` gives it all to the last visible column, `"all"` shares it equally.
  Hidden columns (`width: 0`) stay hidden and a column is never shrunk below
  its configured width; a resize still writes the *configured* width, so the
  host's persisted widths are unaffected.
- `rowHeaders: false` removes the row-number column and the select-all corner
  and shifts every column left by the header width.

### Initial column order — `orderColumnsById`

The grid is positional: `fieldIds[i]`, `datasetHeader.fields[].column`,
`initialData` addresses, `columnWidths[i]` and `onColumnMove(from, to)` all
index the same column, and the host already rebuilds those arrays when it
persists a move. There is therefore no separate in-component display order to
set — the order **is** the order of the host's arrays. For a saved initial
order, order the host's columns before mapping:

```ts
import { orderColumnsById } from "@sheetbase-labs/sheetbase-table";

const columns = orderColumnsById(allColumns, presentation.columnOrder);
// then build fieldIds / datasetHeader / initialData from `columns`, as usual
```

`orderColumnsById(columns, order)` puts ids named by `order` first (unknown and
duplicate ids dropped), then the remaining columns in their existing order.

### Formula-engine seams — `formulaEngine`

The package owns calculation (ADR-0048 option (b)) — it compiles and evaluates
`"=…"` inputs itself — so a host's *engine instance* cannot be injected; the
supported "host owns calculation" mode remains `calculationAuthority: "host"`
(formulas stay inert text, values arrive through hydration). What can be
configured are the seams of the engine that does run:

```ts
type SpreadsheetFormulaEngine = {
  /** Resolves qualified cross-sheet references (`Sheet1!A1`) to a scalar. */
  referenceResolver?: ReferenceResolver;
  /** Rewrites formula text before compilation, after structured-token substitution. */
  formulaNormalizer?: FormulaNormalizer;
};
```

`formulaNormalizer` receives the text *after* the built-in `[fieldId]` → range
substitution; both seams are read at mount, and a changed `formulaNormalizer`
renormalises the sheet (remount to reset `initialData`-style state).

There is deliberately no way to inject a foreign engine instance or a
`sheetName`: one `Spreadsheet` is one sheet backed by the package's engine, and
multi-sheet ownership stays with the host (the package's `TableWorkbook`
composes several). The transitional ELN `formulas: { engine, sheetName }` is
obsolete under ADR-0048 option (b) — the server adopts this engine, so
calculation lives in (or behind) the grid, and `calculationAuthority: "host"`
covers a host that still owns calculation.

### Imperative handle — select and scroll

`SpreadsheetHandle` (the `ref`, or the handle passed to `onReady`) exposes the
interaction commands a host needs after it changes its own rows:

```ts
selectCell(row: number, column: number, options?: { extend?: boolean }): void;
selectCellAddress(address: string, options?: { extend?: boolean }): boolean;
scrollCellIntoView(row: number, column: number): void;
```

`selectCell` takes **displayed** coordinates, clamps them to the grid, moves the
selection (extending from the anchor when `extend` is true), scrolls the cell
into view and focuses the grid. `selectCellAddress` takes a **stored** A1
address, resolves it through a local sort/filter view, and returns `false` when
the address is malformed or the row is hidden. `scrollCellIntoView` scrolls
without touching the selection or focus.

```tsx
const [table, setTable] = useState<SpreadsheetHandle | null>(null);
// later, after appending a row:
table?.selectCellAddress(`A${rows.length}`);
```

`onReady(handle)` fires once after mount for hosts that hold no ref; the same
handle is available through `ref`.

`selectCell`/`selectCellAddress` clamp against the row count of the latest
render, so call them after a data change has rendered (e.g. in an effect that
runs when the rows change, or after `await`ing the state update) — calling them
synchronously after `replaceData` in the same tick clamps to the old row count.

## Multi-select option fields and large pastes

Set `multiple: true` on a dataset field that has `options`. Editing such a cell opens a checkbox picker; the committed value is the selected options joined with `", "`, and validation accepts any comma-joined combination of the allowed options.

Pastes are applied synchronously up to 20,000 cells (`PASTE_CHUNK_CELLS`). Larger pastes are applied in frame-sized slices with a single undo entry per slice, and the polite live region announces progress. `parseTsv` and `applyTsvRows` are exported from `grid/model` so hosts can reuse the same chunking.
# Public component

`SheetbaseTable` composes one active `Spreadsheet` renderer with optional formula and sheet bars. The caller owns sheet state and chooses the active sheet, so inactive TanStack virtualizers are never mounted.

Dataset headers are optional:

```tsx
<SheetbaseTable
  spreadsheet={{ initialData, datasetHeader: { fields } }}
/>

<SheetbaseTable
  spreadsheet={{ initialData: freeFormCells }}
/>
```

Read-only mode locks values, structure and sheet chrome while keeping selection, copy, sorting and filtering live:

```tsx
<SheetbaseTable
  spreadsheet={{ initialData, datasetHeader: { fields } }}
  readOnly
/>
```
