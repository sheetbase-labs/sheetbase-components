# sheetbase-advanced-search

Nested AND / OR / NOT search with grouping, sorting, limit, and a live table preview. Filter evaluation lives in `sheetbase-shared`.

```bash
bun install
bun run dev:search   # http://localhost:5203/
```

```tsx
import { AdvancedSearch, applySearch } from "sheetbase-advanced-search"
import "sheetbase-advanced-search/styles.css"
```

## Filter popover (v3)

`FilterBuilder` is the filter-builder popover — rows of field / operator / value,
then Add condition, Clear and Apply. `FilterChips` is the applied-filter row above
the table: one chip per condition with a named remove label, then "+ Add filter".
Both render theme variables only, so a `.sheetbase-scope` (or the v3 preset) themes them.

```tsx
import { FilterBuilder, FilterChips, applyFilter } from "sheetbase-advanced-search"

<FilterBuilder
  node={filter}                        // the applied AND root
  fields={[{ id: "status", label: "Status", dataType: "text", options: ["In progress"] }]}
  onChange={setFilter}                 // live draft
  onApply={(node, query) => setFilter(node)} // query is a DatasetQuery
/>
<FilterChips node={filter} fields={fields} onRemove={removeCondition} onAdd={openBuilder} />
```

`applyFilter` is the same compile step Apply runs: flat `filters` when the tree
flattens via `compileToDatasetQuery`, `filterTree` otherwise.
