# Sheetbase Table hand-off

## Start here

- Repository: `phlohouse/sheetbase-table`
- Working branch: `feature/table-surface-inspector`
- Latest branch commit at hand-off: `65dfc2e363eb9a7de3c1f92f25383bad121b9856`
- Do not start chart work. The current priority is a dense, reliable spreadsheet/database-table experience.

```bash
git fetch origin
git switch feature/table-surface-inspector
git pull
bun install
bun run dev:herdr
```

Open `http://localhost:5173/million` (the home page at `/` links the bare, default, and million-row demos; legacy `/?paged=1` redirects to `/million`). The Herdr command starts the Bun example API on port 8787 and Vite on port 5173 in labelled tabs. The browser only needs port 5173; Vite proxies `/api/table` to Bun.

## Product intent

This is not a generic data-grid wrapper or an Excel clone. A cell can represent a database record field, a sheet-local value or a formula while preserving record identity, types, validation and revision-aware writes. The visible table should feel spreadsheet-fast while remaining compatible with Postgres-backed Sheetbase datasets.

The design direction is compact, high-density and restrained:

- Instrument Sans for UI text and a compact mono font for coordinates/data;
- 12px primary table/control text and 10–11px metadata;
- rounded table, panel and popover surfaces;
- subtle grey bordered work surface around the table;
- violet only for selection and primary interaction;
- light and dark themes owned by `TableSurface`;
- inspector-style controls with small grey inputs and minimal padding;
- no large generic sidebar, permanent diagnostic clutter, oversized controls or heavy colour.

## Current capabilities

### Grid and data

- TanStack-virtual viewport rendering and million-row logical datasets.
- Immediate empty-grid paint with requested-cell loading placeholders.
- Viewport-aligned page loading, cache reuse and delayed neighbouring-page prefetch.
- HTTP paging, server sorting/filtering, record creation and revision-aware updates.
- Optimistic conflicts and visible pending/saved/conflict/failed write states.
- Text, number, date, boolean, controlled-vocabulary and relationship editors.
- Formula parsing/evaluation, structured field references and coloured reference ranges.
- Direct formatting of a cell, range, row or column.
- Conditional formatting by semantic field or ordinary range, including colour scales.
- Light/dark theme support.

### Table surface

- `TableSurface` is a slightly larger bordered grey wrapper around the table.
- Adjacent objects can occupy the right or bottom area inside that wrapper.
- The conditional-formatting inspector is a resizable right-side object.
- The wrapper is deliberately ready for future objects, but charts are out of scope for now.

### Toolbar and table configuration

- Text colour and fill colour use document-level popovers so they are not clipped by the toolbar.
- `TableFormattingToolbar` accepts `colours`, `darkColours`, `defaultTextColour` and `defaultFillColour`.
- Recent colours are prepended without duplicating configured palette entries.
- The toolbar exposes **Filters** and **Columns** only. Named views were removed because they felt like an Airtable concept awkwardly inserted into the spreadsheet toolbar.
- Configuration is remembered automatically through `TablePresentationAdapter`.
- Filters support multiple clauses, repeated fields, match-all/match-any, typed values, removable chips and clear-all.
- Columns supports search, show/hide, ordering, stored widths, width display and reset.
- Header drag/reorder, header resizing, visibility and frozen-column state use the same persisted presentation model.

### Performance diagnostics

- Optional status pill reports loaded/total rows and separate API, hydration and render timings.
- Optional cell-click timing is included in the pill.
- Timings are off by default in the reusable component but deliberately enabled in the million-row demo.

## Important files

| File | Responsibility |
| --- | --- |
| `src/ui/Spreadsheet.tsx` | Low-level grid rendering, editing, selection, menus, resizing and formatting |
| `src/ui/PagedSpreadsheet.tsx` | Connects viewport paging, cache, hydration, writes and timing status |
| `src/ui/TableSurface.tsx` | Wrapper layout, formatting toolbar and conditional-formatting inspector |
| `src/ui/PagedDemo.tsx` | Million-row composition and current Filters/Columns controls |
| `src/ui/presentation-state.ts` | Versioned serialisable presentation state and persistence adapter |
| `src/ui/styles.css` | Compact light/dark component styling |
| `src/data/*` | Adapter, HTTP, paging, cache, query and conflict boundaries |
| `examples/million-row-api.ts` | Runnable Bun API for one million logical records |
| `e2e/paged-demo.spec.ts` | Browser-facing regression coverage for this composition |

## State and architecture notes

- `TablePresentationState` currently contains theme, rules, direct formats, surface objects, query, column layout, frozen-column count and legacy saved-view fields.
- Saved-view controls are no longer rendered. The legacy `views` and `activeViewId` fields remain in the serialised schema for backward compatibility; do not reintroduce their UI without an explicit product decision.
- The demo uses local storage key `sheetbase-table:presentation:experiments`. Persistence is scheduled during browser idle time to avoid blocking interactions.
- A production host should provide a database-backed `TablePresentationAdapter`; the component must not assume local storage.
- `TableControls` is public API (`src/ui/TableControls.tsx`, exported via `ui/index.ts`): controlled props for filters, column visibility/order, frozen columns and theme; `PagedDemo.tsx` composes it.
- Conditional rules target semantic `fieldId` values where possible, so they survive column reordering.
- Hiding or reordering visible fields remounts the paged spreadsheet with the new semantic projection; the adapter-scoped page cache keeps this bounded.
- Column widths are stored by semantic field in `ColumnPresentation`, not by visible coordinate.

## Verification at hand-off

The latest local verification completed successfully:

```text
89 unit tests passing
TypeScript noEmit passing
Application production build passing
Library declaration/build passing
Library bundle approximately 37 kB gzip plus worker/CSS
```

The recent browser tests were updated, but Chromium/Firefox/WebKit were not executed in the hand-off container because Playwright browser binaries were not installed. Run them in the normal Bun environment:

```bash
bunx playwright install chromium firefox webkit
bun run test:e2e
```

Treat a configured E2E test as unverified until it has run. In particular, exercise Filters and Columns manually after pulling because prior regressions involved popovers being clipped by `overflow: hidden` ancestors.

## Recommended next work

1. Run the full cross-browser suite and fix any real interaction regressions.
2. Extract the Filters/Columns controls from `PagedDemo.tsx` into a reusable, controlled public component.
3. Add keyboard navigation, focus return, Escape handling and ARIA semantics to every portal popover.
4. Improve filter conditions by field type: relative dates, numeric between, multi-select options and explicit blank/not-blank.
5. Add drag-and-drop ordering inside the Columns panel, while retaining accessible move buttons.
6. Add a configurable presentation adapter example showing server persistence without reintroducing named views.
7. Audit render stability with React Profiler after filter, visibility, reorder and width changes; keep ordinary cell selection independent from presentation-state renders.

## Guardrails

- Preserve semantic record/field identity through every visual operation.
- Do not make a million-row operation scan or materialise the full dataset in the browser.
- Keep initial paint to the required page; prefetch only after the first hydration.
- Do not silently swallow real load/write failures; only intentional aborts are ignored.
- Keep popovers in portals or otherwise prove they cannot be clipped by the table wrapper.
- Maintain the 12px compact scale and both themes for every new control.
- Avoid adding charts, named views, a permanent toolbar expansion or a large generic settings sidebar without explicit approval.
- Update unit tests, E2E coverage, component documentation and the public declaration build with every API change.

## Standard verification

```bash
bun run test
bun run build
bun run build:lib
bun run bench
bun run test:e2e
```

See `docs/architecture.md`, `docs/components.md` and `docs/design.md` for the broader engine, integration and visual contracts.
