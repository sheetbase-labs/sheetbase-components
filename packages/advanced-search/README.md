# @sheetbase-labs/sheetbase-advanced-search

Nested AND / OR / NOT search with grouping, sorting, limit, and a live table preview. Filter evaluation lives in `@sheetbase-labs/sheetbase-shared`.

```bash
bun install
bun run dev:search   # http://localhost:5203/
```

```tsx
import { AdvancedSearch, applySearch } from "@sheetbase-labs/sheetbase-advanced-search"
import "@sheetbase-labs/sheetbase-advanced-search/styles.css"
```

## Filter popover (v3)

`FilterBuilder` is the filter-builder popover — rows of field / operator / value, then Add condition, Add group, Clear and Apply. A group is a row holding its own conditions that matches **All of**, **Any of** or **None of** them (AND / OR / NOT; NOT means none of the children match, as `buildPredicate` does). The root stays AND, so a flat AND tree looks and compiles exactly as before; an OR or NOT root passed as `node` shows as one group row instead of being flattened. `FilterChips` is the applied-filter row above the table: one chip per condition or group with a named remove label, then "+ Add filter". A group is one chip ("None of: Project is AAV8 TFF"), removed as a unit; pass `onEdit` and clicking a chip calls it with the node id, which you hand back to the builder as `focusId` to open it at that row. Both render theme variables only, so a `.sheetbase-scope` (or the v3 preset) themes them.

```tsx
import { FilterBuilder, FilterChips, applyFilter } from "@sheetbase-labs/sheetbase-advanced-search"

<FilterBuilder
  node={filter}                        // the applied AND root
  fields={[{ id: "status", label: "Status", dataType: "text", options: ["In progress"] }]}
  onChange={setFilter}                 // live draft
  onApply={(node, query) => setFilter(node)} // query is a DatasetQuery
/>
<FilterChips node={filter} fields={fields} onRemove={removeCondition} onAdd={openBuilder} />
```

### Async options and counts

A field with `loadOptions(query)` gets a type-ahead combobox as its value editor for equals, does not equal and any of. Calls are debounced and stale answers are dropped. Chosen labels are remembered, so chips show "AAV8 TFF", not a UUID; values already in a saved filter are looked up once with `loadOptions(value)`, which should therefore also return the option whose `value` matches. `useOptionLabels(fields, node)` is the same resolver as a hook for your own chips.

```tsx
const project: SheetbaseField = {
  id: "project", label: "Project", dataType: "relationship",
  loadOptions: async (q) => (await api.projects({ q })).map((p) => ({ value: p.id, label: p.name })),
}
<FilterBuilder fields={[project]} node={filter} matchCount={count} onChange={(draft) => fetchCount(draft).then(setCount)} />
```

`matchCount` is optional: the host runs its own count for the draft and Apply reads "Show 42 results". `null` or no value leaves it "Apply".

`applyFilter` is the same compile step Apply runs: flat `filters` when the tree flattens via `compileToDatasetQuery`, `filterTree` otherwise. Empty groups are dropped first (`pruneEmptyGroups`), since an empty Any of would match nothing. Tree helpers: `addGroup`, `setCombinator`, `removeGroup`, plus `addCondition(root, field, groupId?)`.

### Search box syntax

`parseSearchQuery(input, fields)` and `formatSearchQuery({ text, filter }, fields)` (from `@sheetbase-labs/sheetbase-shared`, re-exported here) turn a search box string into free text plus a filter tree and back:

| Token | Meaning |
| --- | --- |
| `status:approved`, `status:"in review"` | equals (contains on plain text fields; `title:=exact` forces equals) |
| `-status:approved` | NOT |
| `status:a,b` | any of |
| `osmolality:>5`, `created:<2026-10-01` | `>` `>=` `<` `<=` on numbers and dates |
| `osmolality:280..320` | between |

Keys match a field's id or label, ignoring case. An unknown key stays free text, and so do quotes, `-word` and `OR`, verbatim, for the server's `websearch_to_tsquery`. `isQueryExpressible(filter, fields)` says whether the box can show the whole filter; OR groups and operators without a token need the builder.
