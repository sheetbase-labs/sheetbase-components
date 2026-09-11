# Workbench composition

The demo workbench (`packages/demo/src/Workbench.tsx`) is the reference
composition: five components docked as panes that interoperate through one
workspace. This document is the recipe — each piece below is shared code, and
the demo consumes it rather than re-deriving it.

## The layout

A `PaneLayout` tree gives every component a real pane — draggable tabs,
resizable splits, closable panes — persisted under one key:

```tsx
<PaneLayout
  panes={panes}
  layout={layout}
  onLayoutChange={setLayout}
  persistKey="my-app:workbench"
  adapter={createLocalStorageAdapter<PaneLayoutState>()}
  onClosePane={(id) => setClosed((c) => new Set(c).add(id))}
  onRequestNewPane={requestNewPane}
/>
```

Closed panes are a `ReadonlySet<string>` the host persists under its own key;
"New pane…" re-opens the first closed id via `PaneLayoutHandle.addPane`.

## The one-AnalysisView rule

`AnalysisView` (shared) is the contract between the search pane and the
explorer — filter tree, grouping, summary, sort, limit. **Keep exactly one**
and hand it to both:

- `AdvancedSearch` gets `value={view}` + `onChange` (a partial merge).
- `Explorer` gets `view={view}` + `onViewChange` (a full replace).

`useWorkbench` owns this triad — the view, the compiled `DatasetQuery` the
table follows, and the derived row slices:

```tsx
const wb = useWorkbench({
  fields: headerFields,              // SheetbaseField[] — see schema wiring below
  rows,                              // workspace snapshot rows
  initialView: emptyView("mean"),
  persistKey: "my-app:search",       // loads a stored view once at mount
  adapter: searchAdapter,            // saving stays with the AdvancedSearch pane
});

<AdvancedSearch value={wb.view} onChange={wb.patchView}
  onDatasetQueryChange={wb.setQuery} ... />
<Explorer dataset={explorerDataset} view={wb.view} onViewChange={wb.setView} ... />
<RulesEngine rows={wb.viewRows} ... />
<WorkspaceProvider value={wb.workspace}> ... </WorkspaceProvider>
```

- `wb.viewRows` — rows after the view's filter + sort + limit; feed the
  explorer dataset and the rules dry-run.
- `wb.filteredRows` — filter + sort without the limit; the "filtered N / M"
  counter.
- `wb.workspace` — the `WorkspaceProvider` value (`{ fields, rows, query }`)
  the table reads through `useWorkspace`.

## The query channel

Search compiles the view to a `DatasetQuery` (with `filterTree` authoritative —
see the shared README) and reports it through `onDatasetQueryChange`. The host
forwards it to `WorkspaceProvider`; a paged table pane reads it via
`useWorkspace().query` and refetches. Never translate the query into something
component-local — `queryKey` makes it a stable cache key.

## Persistence

Each pane persists under its own key with a `PersistenceAdapter`
(`createLocalStorageAdapter` by default; `createHttpAdapter(baseUrl)` for a
database-backed host speaking `GET {baseUrl}?key=` / `PUT {baseUrl}
{key,state}` — the table's `createHttpPresentationAdapter` and the explorer's
`createHttpExplorerAdapter` are thin wrappers over it):

| Pane | State | Key (demo) |
|---|---|---|
| PaneLayout | `PaneLayoutState` | `sheetbase-demo:workbench` |
| SchemaEditor | `SchemaGraph` | `sheetbase-demo:schema` |
| RulesEngine | `PipelineRule[]` | `sheetbase-demo:rules` |
| AdvancedSearch | `AnalysisView` | `sheetbase-demo:search` |

## Schema → table headers

`SchemaEditor`'s `onHeaderFieldsChange` emits `SheetbaseField[]` (with the
column index) for the selected model; the host stores them and they become the
workspace `fields` — so renaming a field in the schema pane re-labels the
table column.

## Rules → filtered rows → write-back

`RulesEngine` receives `rows={wb.viewRows}` (what the user sees is what the
rules evaluate). Write-back is host-owned: `onApplyWrites` commits through the
same `PagedDataAdapter` the table reads, mirrors accepted writes into the
workspace `rows`, invalidates the shared `DataPageCache`, and remounts the
table so it re-reads committed state.

## Scaling to server data

`WorkspaceState.rows` is optional — when the dataset is too large to
materialise, set `workspace.source` to a `WorkspaceDataSource` (the structural
shape of `PagedDataAdapter.fetchPage`) and let the table pane page from it.
The view/query contract is unchanged; only the row realisation moves.

## Follow-ups

Saved views / named workspaces are a natural next layer — `PersistenceAdapter`
+ the view triad already imply the shape — but are deliberately not built yet.
