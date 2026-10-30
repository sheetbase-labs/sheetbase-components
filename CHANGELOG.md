# Changelog

All notable changes to the Sheetbase packages. The six libraries release in lockstep — one version line, all packages bump together.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.7.0] — 2026-10-30

### Added

- **Advanced search**: `FilterBuilder` groups — **Add group** rows that match All of, Any of or None of their conditions (AND / OR / NOT), with `addGroup`, `setCombinator`, `removeGroup` and `pruneEmptyGroups`. OR and NOT roots are no longer flattened to AND. `FilterChips` shows a group as one chip, removed as a unit, with `onEdit` and `FilterBuilder` `focusId` to open the builder at it; `describeNode` phrases any node.
- **Advanced search**: async options — `SheetbaseField.loadOptions(query)` drives a debounced combobox in the value editor for equals, does not equal and any of, and chips show option labels via `useOptionLabels`. `FilterBuilder` `matchCount` turns Apply into "Show 42 results".
- **Shared**: search box syntax — `parseSearchQuery`, `formatSearchQuery` and `isQueryExpressible` for `key:value`, quoted values, `-key:value`, `key:a,b`, comparisons and `a..b` ranges, leaving other text verbatim.
- **Shared**: `FieldOption` and `SheetbaseField.loadOptions`; `operatorsForField` treats a field with `loadOptions` like one with options.

### Changed

- **Shared**: the short label for the `in` operator reads "is any of" (was "is one of").

- **Studio** (`@sheetbase-labs/sheetbase-studio`, new package): explore and chart any table. A field browser profiles every column (missing, distinct, quantiles, top values, bins) and filters on click; the explorer, advanced search, a read-only paged grid and a SQL pane follow one `AnalysisView`. Small tables explore locally; large ones stay at the source with exact aggregates and bins and labelled samples. Read-only SQL opens results as new tables, and the view is shown as SQL, Ibis and pandas. Chart exports embed provenance (source, table, query SQL, filter tree, chart spec, row count).
- **Studio sources**: `MemorySource` (host rows), `DuckDbSource` (DuckDB-WASM; CSV, TSV, JSON, Excel and Parquet uploads, offline-safe) and `HttpSource` over a documented wire contract (`/api/studio/*` plus the existing pages and aggregate routes).
- **Shared**: `StudioDataSource`, `TableInfo`, `FieldProfile` and the studio wire types; `workspaceSourceFor`.
- **Filter parity**: `filterToSql` compiles filter trees to DuckDB SQL with `buildPredicate` semantics; `packages/studio/fixtures/filter-parity.json` pins JS, DuckDB and Python (Ibis) executors to the same results.
- **Python** (`python/`, `sheetbase-studio`): `sheetbase.serve(df)` / `sheetbase serve` and the `sheetbase.explore(df)` notebook widget, backed by Ibis — pandas, polars, pyarrow, files or any Ibis backend. SQL is checked read-only with sqlglot; `apply_view` reproduces a Studio view in code.
- **Explorer**: `RemoteDatasetSource.histogram` (exact server bins) and `.sample` (seeded samples, labelled on the chart) so remote datasets draw histograms, scatter, box, violin and heatmap; count charts plot group sizes without a measure; `shareUrl` lets embedding hosts opt out of URL hash writes; `defaultChartSpec`, `smartKindFor`, `binsToRows`, `bucketsToRows`, `ROW_ID` and `HISTOGRAM_BIN` are exported.

- **Table**: host-driven layout and control on `Spreadsheet` — `height` (`number | "fill"`), `stretch` (`"none" | "last" | "all"`, measured against the scroll container), `rowHeaders: false` to drop the row-number column and corner, and `formulaEngine` seams (cross-sheet `referenceResolver`, host `formulaNormalizer`). `orderColumnsById(columns, order)` applies a saved initial column order at the composition boundary. Structural row hooks `onBeforeRowsInsert`/`onRowsInserted`/`onBeforeRowsRemove`/`onRowsRemoved` now fire from the row menu and the handle — including for bound grids, where the row menu's insert/delete are no longer hidden and the hooks report stored rows for the host to persist. `SpreadsheetHandle` gains `selectCell`/`selectCellAddress`/`scrollCellIntoView`, and `onReady(handle)` hands the handle to hosts that hold no ref. The clipboard hooks' existing replacement payload (copy/cut/paste) is documented with a formula-rewrite example.
- **Explorer**: standalone v3 chart figures — `Chart` (one figure) and `ChartGroup` (charts sharing an x axis), spec in and SVG out with no explorer `App`. Series colours come from `series-a/b/c` with circle/square/triangle markers by series index, `excludeField` points draw hollow (and are pinned at the plot edge with a value label when off-scale), reference lines are dashed and labelled with value and unit, and axis titles carry units (`xUnit`/`yUnit`). `buildFigure`/`buildFigureGroup` expose the geometry model.
- **Explorer**: `FieldRolePanel` — the Analysis screen's field list and axis wells (drag or pick a field onto x, y, y2 or series, plus calculated `ƒx` fields), with `rolesFromSpec`/`specWithRole`/`chartFieldsFromDataset` mapping the panel onto `ChartSpec`.
- **Schema editor**: SQL query import — `analyzeSql`/`sqlToGraph` turn pasted or dropped SQL into an ERD (source tables, joins, CTEs/subqueries, result columns) with dbt support (`{{ ref }}`/`{{ source }}` expansion, `-- model.sql` headers, any file order). Query nodes (`kind: cte | subquery | query | view`) are design-time only and skipped by `graphToDdl`/`graphToProvision`/`diffGraphs`. The Import SQL dialog gains file pick/drop and a live preview.
- **Schema editor**: filled per-kind edge arrowheads that stop short of the target node, with staggered entry points for parallel edges.
- **Schema editor**: canvas navigation — the wheel zooms anchored at the cursor, drag pans (middle button anywhere, left button on empty canvas), and a Focus toggle that greys out models which are not upstream or downstream of the selection (full chain, not just neighbours).

- **Studio binary** (`packages/studio-cli`, new): `sheetbase-studio`, one executable for Linux (x64, arm64), macOS (Apple Silicon, Intel) and Windows that serves the Studio over files (CSV, TSV, Parquet, JSON, Excel), SQLite, DuckDB, Postgres and MySQL — no Python, Node or drivers, nothing downloaded at runtime. Read-only: databases attach read-only and DuckDB is locked down after startup. Localhost by default with DNS-rebinding protection; an access token is required beyond localhost. Database tables get SQL-friendly names and are counted on first use. Pull requests build and smoke-test the Linux binary and run it against Postgres 16 and MySQL 8.4; macOS, Windows and Linux arm64 build on main and in releases (smoke-tested on macOS and Windows runners), and releases attach all five binaries with checksums.
- **Studio**: `DuckDbSource.openPath` (Parquet as a view, CSV/TSV read from disk), a server-side entry (`src/node.ts`), `registerTable({ countRows: false })` for uncounted database tables, and a `sql` option on `DuckDbSource`.

### Fixed

- **Explorer**: the chart draws at its stage's real height. It was measured once, before the stage mounted, so hosts that render the explorer after a load got a fixed 420px figure that the browser scaled — unreadable text on short screens, letterboxing on tall ones. `stageChartHeight` is exported for hosts that size it themselves.
- **Explorer**: the command bar wraps instead of clipping tools at narrow widths.
- **Explorer**: narrow canvases tighten both toolbars so the tools fit in two rows on a phone. `showImport={false}` hides the Import menu for hosts that own the data (Studio does), so the chart can't diverge from the page.
- **Studio**: a multi-sheet Excel file names its tables after the sheets (`runs_runs`, `runs_plates`) — the sheet name was being stripped with the extension. An upload can no longer take a table id a database table already uses, and a failed Parquet read reports DuckDB's error when no fallback reader is available.
- **Table**: copy, cut and paste work whenever the grid has focus. Browsers aim clipboard events at the page's text selection, which a cell click doesn't move — after an editor closed it could sit outside the grid, so Ctrl+C silently did nothing (seen on Chromium 141). Stray events are now taken by the focused grid; events inside it are unchanged.
- **Table**: in the default dark theme the selected row number and column label were drawn in their own background colour (fallback ink was `--accent-soft`); they now use `--accent-ink`. Presets that set `--grid-*-selected-ink` (v3) are unchanged.
- **Studio**: on phones and narrow embeds the top bar is one row — table, source and a "⋯ More actions" menu holding the row count, Open file, Export chart, Provenance and the theme; notices float under the bar. A single tabbed stack drops the redundant pane menu, and section headers (SQL "This view as code") wrap their actions under the title.
- **Advanced search**: the summary agrees with its counts — "1 condition · 1 group" — and its status text truncates before the Preview/Clear actions are pushed out of a narrow bar.
- **Shared**: `.sb-subbar` and the shell frame's topbar row keep their 31/33px minimum but grow when a host's bar wraps, instead of clipping the second row.

### Changed

- **Packaging**: the six libraries are now scoped `@sheetbase-labs/*` and publish privately to GitHub Packages (each manifest sets `publishConfig` to `https://npm.pkg.github.com` with `access: restricted`). The release workflow authenticates with the built-in Actions token (`permissions: packages: write`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) instead of a public-npm `NPM_TOKEN`, and no publish path passes `--access public`.
- Schema editor dev demo fills the viewport with a small margin.
- Schema editor query-import nodes drop the green left stripe; the green header and kind chip carry the distinction.
- Schema editor dev server pre-bundles `@sheetbase-labs/sheetbase-shared` (one library module instead of ~20 source modules) and gains `bun run dev:bundled`, a watch-build
  + preview mode the orb portal uses: the page went from 40 requests / 4.0s to 3 requests / ~0.6s at 250ms RTT. Production builds are byte-identical.

## [0.1.0] — pending first publish

### Added

- **Table**: virtualised grid (million-row capable), paged `DataAdapter` contract with revision-gated cache invalidation, bound-grid write boundary (`recordIdForRow` → `onFieldWrite(s)`/`commitWrites`), formulas, conditional formats, presentation persistence.
- **Explorer**: chart spec editor, local + remote datasets (`remote.aggregate`), SQL workspace over loaded rows, remote first-page row preview via `remote.page`, loading/retry surfaces.
- **Schema editor**: model canvas with relationship edges, inspector editing, `graphToDdl` / `graphToProvision` emission, `ddlToGraph` import (Postgres `create table` → graph), schema→grid materialisation via `onHeaderFieldsChange`.
- **Rules engine**: natural-language rule pipeline, dry-run pane with per-rule match counts, transform writes through the `onApplyWrites` commit boundary, auto-apply with convergence + circuit breaker.
- **Advanced search**: nested boolean filter trees compiling to `DatasetQuery` (authoritative `filterTree`), live match preview.
- **Shared**: `FilterNode` trees + `buildPredicate`, `DatasetQuery`/`queryKey`, `useWorkbench` composition hook, `createHttpAdapter`, `PaneLayout` multiplexer (tab stacks, splits, drag-to-detach), theme/shell CSS.
- **Demo**: workbench composing all five components on one dataset, stacked reference page, docs site with live instances.
- CI: typecheck/lint/tests/builds per package, table e2e on Chromium/Firefox/WebKit, demo e2e, pack smoke (tarballs typecheck as an external consumer), table/explorer bundle budgets and benches.
