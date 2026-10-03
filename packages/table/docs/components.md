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

Typed dataset fields support text, number, date, boolean and relationship input. `required`, `writable`, `computed` and `options` define validation and editability independently of presentation.

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

- `renderCell(context)` replaces the content of a cell. Returning `undefined` keeps the built-in rendering. The context carries `address`, `point`, `display`, `field`, `selected`, `active` and `loading`; selection, keyboard handling and write-state badges are unaffected.
- `customEditors` replaces the built-in input for matched fields. `matches({ point, field })` selects the editor; `render({ point, address, field, initialDraft, commit, cancel })` renders any input UI and calls `commit(value)` to save or `cancel()` to discard.

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

The plain demo (`/`) uses `renderCell` for status badges and a `Copy column name` context-menu action as a working reference.

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
