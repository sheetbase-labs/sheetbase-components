# Sheetbase Components

Private monorepo for Sheetbase UI packages. Shared field types, filter operators, predicate evaluation and chrome live in `packages/shared` so table, explorer, schema editor, rules engine and advanced search stay consistent.

## Packages

| Package | Role |
| --- | --- |
| `sheetbase-shared` | Canonical `SheetbaseField`, `FilterOperator`, `DatasetQuery`, predicate/tree evaluators, theme tokens, framed-shell CSS, theme toggle |
| `sheetbase-table` | Spreadsheet / paged dataset table |
| `sheetbase-explorer` | Chart-first exploration workspace |
| `sheetbase-schemaeditor` | Zoomable schema graph |
| `sheetbase-rulesengine` | Natural-language pipeline rules |
| `sheetbase-advanced-search` | Nested AND/OR/NOT search |

## Run

```bash
bun install
bun test
bun run dev:table      # Vite, proxies /api/table
bun run dev:explorer   # :5199
bun run dev:schema     # :5201
bun run dev:rules      # :5202
bun run dev:search     # :5203
```

GitHub Actions on this repo run unit tests for every package, table/explorer/schema/rules/search production and library builds, table bundle budget and benches, explorer benches, and table Playwright e2e on Chromium, Firefox and WebKit.

Table `PORT` / `SHEETBASE_API_PORT` / `E2E_PORT` overrides from `sheetbase-table` #23 are honoured by Vite, the Herdr helper and Playwright.

## Shared contract

Import from `sheetbase-shared`:

- `FieldDataType`, `SheetbaseField`, `toFieldDataType`
- `FilterOperator`, `operatorsForField`, `normaliseOperator` (`isEmpty` → `isNull`)
- `FilterClause`, `DatasetQuery`, `queryKey`, `buildFilterValue`
- `testCondition`, `toFilterClause`, `filterRows`
- `buildPredicate`, `applySearch`, `compileToDatasetQuery` (flattens a single-level group onto `DatasetQuery`)
- `ThemeToggleButton`, `theme.css`, `shell.css`

Large table `Spreadsheet.tsx` still exceeds the GitHub contents limit, so it is stored as ordered parts under `packages/table/src/ui/spreadsheet.parts/` and concatenated by `packages/table/scripts/assemble-large-files.mjs` before test, dev and build. Function catalogues and table CSS are ordinary modules (`functions-*.ts`, `ui/styles/*.css`).
