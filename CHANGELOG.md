# Changelog

All notable changes to the Sheetbase packages. The six libraries release in
lockstep — one version line, all packages bump together.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
