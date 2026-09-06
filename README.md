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

## Shared contract

Import from `sheetbase-shared`:

- `FieldDataType`, `SheetbaseField`, `toFieldDataType`
- `FilterOperator`, `operatorsForField`, `normaliseOperator` (`isEmpty` → `isNull`)
- `FilterClause`, `DatasetQuery`, `queryKey`, `buildFilterValue`
- `testCondition`, `toFilterClause`, `filterRows`
- `buildPredicate`, `applySearch`, `compileToDatasetQuery` (flattens a single-level group onto `DatasetQuery`)
- `ThemeToggleButton`, `theme.css`, `shell.css`

Large table sources (`Spreadsheet.tsx`, `styles.css`, `functions.ts`) are stored as concatenated parts under `*.parts/` and assembled by `packages/table/scripts/assemble-large-files.mjs` before test/dev/build (GitHub MCP file-size limits during the initial import).
