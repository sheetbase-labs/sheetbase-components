# Sheetbase Components

Private monorepo for Sheetbase UI packages. Shared field types, filter operators, predicate evaluation and chrome live in `packages/shared` so table, explorer, schema editor, rules engine and advanced search stay consistent.

## Packages

| Package | Role |
| --- | --- |
| `@sheetbase-labs/sheetbase-shared` | Canonical `SheetbaseField`, `FilterOperator`, `DatasetQuery`, predicate/tree evaluators, theme tokens, framed-shell CSS, pane multiplexer/shell, theme toggle |
| `@sheetbase-labs/sheetbase-table` | Spreadsheet / paged dataset table |
| `@sheetbase-labs/sheetbase-explorer` | Chart-first exploration workspace |
| `@sheetbase-labs/sheetbase-schemaeditor` | Zoomable schema graph |
| `@sheetbase-labs/sheetbase-rulesengine` | Natural-language pipeline rules |
| `@sheetbase-labs/sheetbase-advanced-search` | Nested AND/OR/NOT search |
| `@sheetbase-labs/sheetbase-studio` | Data exploration: field profiles, explorer, filters, rows and read-only SQL over any data source |

The `sheetbase-studio` Python package (`python/`) serves the Studio over
pandas, polars, files or any Ibis backend — `sheetbase serve` in the browser,
`sheetbase.explore(df)` in a notebook. See `python/README.md`.

## Run

```bash
bun install
bun run test           # vitest, every package
bun run typecheck      # tsc -b, every package
bun run lint           # biome ci
bun run build          # app/demo builds
bun run build:lib      # library builds, in dependency order
bun run dev:table      # Vite, proxies /api/table
bun run dev:explorer   # :5199
bun run dev:schema     # :5201
bun run dev:rules      # :5202
bun run dev:search     # :5203
bun run dev:studio     # :5204
```

The million-row paged demo and the explorer's remote source need the
example API running too: `cd packages/table && bun run dev:api` (:8787).

GitHub Actions on this repo run unit tests for every package, table/explorer/schema/rules/search production and library builds, table bundle budget and benches, explorer benches, a pack smoke test (tarballs install + typecheck as an external consumer), and table Playwright e2e on Chromium, Firefox and WebKit.

The seven libraries are publish-shaped npm packages — see `docs/publishing.md` for the consumption model and release flow. The shared accessibility contract (grid, panes, schema canvas, charts, forms) is documented in `docs/accessibility.md`.

Table `PORT` / `SHEETBASE_API_PORT` / `E2E_PORT` overrides from `@sheetbase-labs/sheetbase-table` #23 are honoured by Vite, the Herdr helper and Playwright.

## Shared contract

Import from `@sheetbase-labs/sheetbase-shared`:

- `FieldDataType`, `SheetbaseField`, `toFieldDataType`
- `FilterOperator`, `operatorsForField`, `normaliseOperator` (`isEmpty` → `isNull`)
- `FilterClause`, `DatasetQuery`, `queryKey`, `buildFilterValue`
- `testCondition`, `toFilterClause`, `filterRows`
- `buildPredicate`, `applySearch`, `compileToDatasetQuery`, `toDatasetQuery` (emits `filterTree` for nested/NOT trees; the tree is authoritative over flat `filters` for executors)
- `ThemeToggleButton`, `theme.css`, `shell.css`, `panes.css`
- `PaneLayout`, `SheetbaseShell`, layout tree helpers and `PaneLayoutState` persistence
- `StudioDataSource`, `TableInfo`, `FieldProfile` and the studio wire types
