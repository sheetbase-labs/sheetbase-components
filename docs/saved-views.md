# Saved views / named workspaces — design

Design document only. Nothing here is built; the product questions in §5 gate implementation. This file is input to a follow-on plan, not a living spec.

## 1. The state worth naming

Every pane already persists something. A "saved view" could capture any subset of:

| State | Shape | Owner | Persistence key |
|---|---|---|---|
| Analysis view | `AnalysisView` — filter tree, groupBy, summary, sort, limit | search / shared | `sheetbase-demo:search` |
| Chart spec + SQL | `SavedExploration { id, name, createdAt, updatedAt, spec, sql }` | explorer | inside `sheetbase:explorer` |
| Pane layout + closed set | `PaneLayoutState` + `Set<string>` | workbench | `sheetbase-demo:layout`, closed-set key |
| Table presentation | `TablePresentationState` — theme, columns, frozen, formats, annotations | table | `sheetbase-demo:table-presentation` |
| Schema graph + selection | `SchemaGraph` | schema | `sheetbase-demo:schema` |

Two coherent units:

- **The analysis pair** — `{ id, name, createdAt, updatedAt, view: AnalysisView, spec?: ChartSpec }`. Names "what question am I asking" — the filter/group/summary plus the chart that visualises it. Restoring it re-drives table, explorer, search and rules through the existing controlled props; layout and schema stay where the user left them.
- **The workspace** — the pair plus `PaneLayoutState` + closed set + `TablePresentationState` (+ schema graph). Names "how I have my desk arranged". Captures more, but conflates personal chrome with analysis semantics: restoring a colleague's "workspace" would rearrange your panes, and layout is already what users adjust most casually.

**Recommendation: the analysis pair.** It is the smallest unit whose restore is meaningful — `setView(saved.view) + setSpec?.(saved.spec)` re-drives every pane through the shared view, which is the composition's whole point. Layout/table-presentation/schema are per-user chrome that already persists and survives across view switches. If hosts later want named *workspaces*, the pair nests inside it unchanged.

## 2. Relationship to `SavedExploration`

The explorer already ships a saved-spec list inside `PersistedExplorerState.saved[]`. Options:

- **(a) Hoist**: a shared `SavedView` type carries `spec` as one slice; the explorer's saved list becomes a projection of the workbench-level list. The `saved[]` array lives inside a versioned persisted shape, so hoisting is a `PersistedExplorerState` version bump + migration that lifts entries out — plus a prop surface (`savedViews`, `onApplySavedView`), not new machinery.
- **(b) Parallel**: explorer keeps saving charts, workbench saves views. Two lists, two pickers, near-identical shapes — a chart saved in the explorer can't be applied from the workbench and vice versa.

**Recommendation: (a).** One list, one picker, `spec` already optional. The migration must carry `saved[]` forward when the field moves out of `PersistedExplorerState` — silent drops are the failure mode.

## 3. Where it lives

`PersistenceAdapter<SavedView[]>` under a workbench-level key (the demo would use `sheetbase-demo:views`; the adapter interface — local storage, HTTP `GET ?key=`/`PUT`, or anything else — already exists and is unchanged). CRUD as pure helpers in `@sheetbase-labs/sheetbase-shared`:

```ts
upsertSavedView(list: readonly SavedView[], view: SavedView): SavedView[]
removeSavedView(list: readonly SavedView[], id: string): SavedView[]
```

The picker renders host-side — the workbench tools strip (where the demo's source switcher already sits), not a per-pane control. `PaneSpec.actions` is the precedent for pane-local actions; a saved-view picker is deliberately above the panes, since it drives several at once. `useWorkbench` would gain `savedViews`/`onSaveView`/`onApplyView` — thin pass-throughs, mirroring how `view`/`onViewChange` already flow.

## 4. Apply semantics

Applying = `setView(saved.view)` + `setSpec?.(saved.spec)` through the existing controlled props. The compiled `DatasetQuery`, table paging, explorer aggregation and rules sampling all follow — that is the composition working, not new machinery.

On remote datasets (post-019) a saved view is **dataset-relative**: `view.filter` fieldIds and `spec` channels must be validated against the active dataset's fields before applying — the explorer already does this on dataset swap (`channelDefaults` + the stale-channel drop in `App.tsx`); the design reuses that path and reports dropped fieldIds to the host rather than silently no-opping.

## 5. Product questions for the maintainer

1. **Scope**: is a saved view the *analysis pair* (recommended) or the full *workspace* including layout and table presentation?
2. **Level**: is this a workbench/host concept (recommended — the explorer's `saved[]` hoists) or should each component keep its own named-state feature?
3. **Table legacy**: `TablePresentationState.views`/`activeViewId` are frozen scar tissue — do they migrate into `SavedView`, or stay frozen and unrelated? (HANDOFF forbids reintroducing the table's views UI; this question is about the persisted *fields* only.)
4. **Audience**: per-user or shared views? The HTTP adapter supports either by key convention — but "shared" pulls in auth/identity questions that are currently out of scope.
5. **Dataset coupling**: should a saved view record the dataset id it was created against and refuse/warn on other datasets, or attempt best-effort field validation everywhere?

## 6. Explicitly not designed

Sharing and permissions, a server-side view catalogue, view diffs or history, and any in-component picker UI beyond the host toolbar slot above.
