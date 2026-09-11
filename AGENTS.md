# AGENTS.md

Bun 1.x workspace monorepo for the Sheetbase component set. Packages live in
`packages/*` and are consumed as workspace dependencies (`sheetbase-shared`,
`sheetbase-table`, `sheetbase-explorer`, `sheetbase-schemaeditor`,
`sheetbase-rulesengine`, `sheetbase-advanced-search`, `sheetbase-demo`).

## Validate

Run from the repo root unless noted. Order matters: typecheck and lint before
tests when changing contracts.

```bash
bun install
bun run typecheck   # tsc -b per package (single TS version, noEmit)
bun run lint        # biome ci; errors block, warnings are the tracked baseline
bun run test        # vitest, all packages
bun run build       # app/demo builds (all packages)
bun run build:lib   # library builds in dependency order: shared → table → search → explorer → schema → rules
```

Package-level extras (run inside `packages/table`):

```bash
bun run test:e2e    # Playwright; needs `bunx playwright install` once
bun run bench       # sql.bench + million-row harness; baseline in HANDOFF.md
bun run budget      # gzipped lib-bundle size budget
bun run dev:api     # example HTTP adapter on :8787 (paged demo + explorer remote source)
```

`packages/explorer` also has `bun run budget` and `bun run bench`.

```bash
bun run pack:smoke  # pack all six libs, install + typecheck as an external consumer
```

## Conventions

- **Shared contracts live in `packages/shared`** — field types, filter
  operators, `FilterNode` trees, `DatasetQuery`/`queryKey`, `buildPredicate`,
  theme CSS, `SheetbaseShell`/pane layout. Cross-package types and behaviour
  belong there, not in sibling packages.
- **`DatasetQuery.filterTree` is authoritative** over flat `filters` for
  executors that evaluate it (see `packages/shared/README.md`). Both may be
  emitted; consumers must not prefer the flat list when a tree exists.
- **Bound vs unbound grids**: a `Spreadsheet` is bound when its
  `datasetHeader` supplies `recordIdForRow`. Bound grids delegate persistence
  and structure ops (row insert/delete, column ops, local sort) to the host —
  the grid mutates only what it owns. Check `recordIdForRow` before adding
  mutating behaviour, not `readOnly`.
- **Write path**: cell edits go through `runFieldWrite`/`onFieldWrite`; bulk
  mutations derive bound writes via `fieldWritesForMutation` and emit
  `onFieldWrites`. Never update `data` without keeping `recordIdsRef`/field
  identity in sync.
- **Presentation persistence is idle-scheduled** — reload-dependent e2e tests
  must wait for the save to land (see the existing `waitForFunction` pattern
  in `e2e/specs`).
- **Lint discipline**: `biome.json` is the baseline. `noUnusedImports` is an
  error; style/a11y debt is warnings pending later work. Suppress
  deliberately-incomplete hook dependency arrays and intentional numeric
  constants with targeted `biome-ignore` comments — do not silence files.
- **Deliberate divergences** in lint/tooling config are documented in the
  config files themselves.

## Layout

```
packages/shared/          contracts, predicate, tree, query, shell, themes
packages/table/           grid engine, formulas, paging, HTTP adapter, writes
  docs/HANDOFF.md         subsystem notes + bench baselines
  examples/               million-row reference API (dev:api)
packages/explorer/        charts, aggregation, SQL, remote adapter
packages/advanced-search/ nested search UI; compiles FilterNode → DatasetQuery
packages/schema-editor/   schema canvas (reactflow)
packages/rules-engine/    NL rule language → table mutations (dry-run today)
packages/demo/            workbench composing the packages
.github/workflows/ci.yml  typecheck + lint + tests + builds + e2e
```

## Gotchas

- The paged demo and explorer "Remote" source need `dev:api` running.
- `dist-lib/` is consumed by sibling examples at dev time — rebuild
  `build:lib` after changing shared/table contracts.
- `sheetbase-shared` is externalized from the table library build; consumers
  must install both packages.
- Packages publish to npm in lockstep (`docs/publishing.md`). `bun pm pack`
  rewrites `workspace:*` to real versions; peers are `react`, `react-dom`,
  and `@tanstack/react-virtual` (table only — it is externalized, never put
  it back in `dependencies`).
