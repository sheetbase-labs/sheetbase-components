# Changelog

All notable changes to the Sheetbase packages. The six libraries release in
lockstep — one version line, all packages bump together.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Explorer**: standalone v3 chart figures — `Chart` (one figure) and
  `ChartGroup` (charts sharing an x axis), spec in and SVG out with no explorer
  `App`. Series colours come from `series-a/b/c` with circle/square/triangle
  markers by series index, `excludeField` points draw hollow (and are pinned at
  the plot edge with a value label when off-scale), reference lines are dashed
  and labelled with value and unit, and axis titles carry units
  (`xUnit`/`yUnit`). `buildFigure`/`buildFigureGroup` expose the geometry model.
- **Explorer**: `FieldRolePanel` — the Analysis screen's field list and axis
  wells (drag or pick a field onto x, y, y2 or series, plus calculated `ƒx`
  fields), with `rolesFromSpec`/`specWithRole`/`chartFieldsFromDataset` mapping
  the panel onto `ChartSpec`.
- **Schema editor**: SQL query import — `analyzeSql`/`sqlToGraph` turn pasted
  or dropped SQL into an ERD (source tables, joins, CTEs/subqueries, result
  columns) with dbt support (`{{ ref }}`/`{{ source }}` expansion,
  `-- model.sql` headers, any file order). Query nodes
  (`kind: cte | subquery | query | view`) are design-time only and skipped by
  `graphToDdl`/`graphToProvision`/`diffGraphs`. The Import SQL dialog gains
  file pick/drop and a live preview.
- **Schema editor**: filled per-kind edge arrowheads that stop short of the
  target node, with staggered entry points for parallel edges.
- **Schema editor**: canvas navigation — the wheel zooms anchored at the
  cursor, drag pans (middle button anywhere, left button on empty canvas),
  and a Focus toggle that greys out models which are not upstream or
  downstream of the selection (full chain, not just neighbours).

### Changed

- Schema editor dev demo fills the viewport with a small margin.
- Schema editor query-import nodes drop the green left stripe; the green
  header and kind chip carry the distinction.
- Schema editor dev server pre-bundles `sheetbase-shared` (one library module
  instead of ~20 source modules) and gains `bun run dev:bundled`, a watch-build
  + preview mode the orb portal uses: the page went from 40 requests / 4.0s to
  3 requests / ~0.6s at 250ms RTT. Production builds are byte-identical.

## [0.1.0] — pending first publish

### Added

- **Table**: virtualised grid (million-row capable), paged `DataAdapter`
  contract with revision-gated cache invalidation, bound-grid write boundary
  (`recordIdForRow` → `onFieldWrite(s)`/`commitWrites`), formulas, conditional
  formats, presentation persistence.
- **Explorer**: chart spec editor, local + remote datasets
  (`remote.aggregate`), SQL workspace over loaded rows, remote first-page row
  preview via `remote.page`, loading/retry surfaces.
- **Schema editor**: model canvas with relationship edges, inspector editing,
  `graphToDdl` / `graphToProvision` emission, `ddlToGraph` import
  (Postgres `create table` → graph), schema→grid materialisation via
  `onHeaderFieldsChange`.
- **Rules engine**: natural-language rule pipeline, dry-run pane with
  per-rule match counts, transform writes through the `onApplyWrites` commit
  boundary, auto-apply with convergence + circuit breaker.
- **Advanced search**: nested boolean filter trees compiling to
  `DatasetQuery` (authoritative `filterTree`), live match preview.
- **Shared**: `FilterNode` trees + `buildPredicate`, `DatasetQuery`/`queryKey`,
  `useWorkbench` composition hook, `createHttpAdapter`, `PaneLayout`
  multiplexer (tab stacks, splits, drag-to-detach), theme/shell CSS.
- **Demo**: workbench composing all five components on one dataset, stacked
  reference page, docs site with live instances.
- CI: typecheck/lint/tests/builds per package, table e2e on
  Chromium/Firefox/WebKit, demo e2e, pack smoke (tarballs typecheck as an
  external consumer), table/explorer bundle budgets and benches.
