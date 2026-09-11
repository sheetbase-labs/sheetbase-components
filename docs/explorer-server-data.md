# Explorer server data path (spike)

The explorer charts whatever fits in memory: `DataAdapter.load()` returns a
materialised `Dataset { rows }`, and the only built-in sources are the sample
dataset and a whole-file reader. This spike adds the contract that lets the
explorer chart datasets that stay on the server — the same million-row,
Postgres-shaped data the table pages over.

## Contract

### Wire: `POST {baseUrl}/api/explorer/aggregate`

Request body (`AggregateQuery` + `datasetId`, see `lib/types.ts`):

```json
{
  "datasetId": "experiments",
  "filter": { "type": "group", "combinator": "AND", "children": [] },
  "groupBy": "status",
  "summary": "mean",
  "valueField": "result",
  "limit": 50
}
```

- `filter` — the plan-008 `GroupNode` tree, evaluated with
  `buildPredicate` semantics (NOR `NOT`, date-aware comparisons). It is
  authoritative; a server should not also apply a flat `filters` list.
- `groupBy` — the field whose distinct values become buckets; the chart's
  x channel.
- `summary` — `mean | median | sum | count | min | max`.
- `valueField` — the measure; required for every summary except `count`.
- `limit` — cap on returned buckets (applied after a deterministic
  key-ascending sort).

Response (`AggregateResponse`):

```json
{
  "buckets": [{ "key": "Complete", "count": 333334, "value": 49.87 }],
  "totalRows": 1000000,
  "revision": "r12"
}
```

`totalRows` counts matching rows *before* bucketing — it is what the bottom
panel's row count reports.

POST+JSON rather than GET+params because a filter tree is bulky and
structured; the commits route already sets that precedent.

### Client: `Dataset.remote`

`Dataset` gains an optional capability:

```ts
remote?: { aggregate(query: AggregateQuery, signal?: AbortSignal): Promise<AggregateResponse> }
```

`createHttpExplorerAdapter({ baseUrl, datasetId, fields })`
(`lib/adapters/http.ts`) returns a `DataAdapter` whose `load()` resolves
immediately to a metadata-only dataset — `rows: []`, caller-supplied column
metadata, and the bound `remote.aggregate`. No schema endpoint is required;
a real backend could add `GET /api/explorer/schema` later without changing
the contract.

`bucketsToRows` shapes each bucket into the same row `preparedRows` emits
for a client-side aggregate: `{ [groupBy]: key, [valueField]: value,
__sheetbaseCount: count, __sheetbaseRowId: i }`. The chart is then built
with `aggregate: 'none'` so `preparedRows` passes bucket rows through
untouched — downstream code barely notices the data came from a server.

## What goes remote, what doesn't

A spec goes remote when `chartSpec.aggregate !== 'none'` and the chart kind
consumes aggregated rows — bar, horizontal-bar, pie, donut, line, area,
scatter-with-aggregate, lollipop, waterfall. These are exactly the specs for
which `preparedRows` groups+summarises.

Raw-row specs can't be served by this contract: `aggregate === 'none'`,
histogram, box, violin, and heatmap always draw distributions of raw rows.
On a remote source these show an explicit note ("pick an aggregate…")
instead of an empty chart — the honest answer rather than a silent cap.

On remote datasets the bottom panel shows the same note in place of the
data table and the SQL workspace: alasql runs in a worker over materialised
rows and cannot see a remote dataset. Pushing SQL server-side is out of
scope.

## Correctness properties

- **Filters apply once.** The shared view's tree is sent intact; flat spec
  filters are rebuilt into a tree first. Bucket rows are never re-filtered
  client-side (they don't carry the original fields).
- **Stale responses can't win.** Each spec/source change aborts the
  in-flight request (`AbortController`), and a response is only applied if
  its dataset is still the active one — the same discipline as the SQL
  pane's generation guard.
- **Remote markers don't leak into persistence.** `PersistedExplorerState`
  holds spec/sql/theme/saved — never the dataset — so a `remote` flag can't
  be restored into a session that lacks the adapter.

## Known limitations (documented, not bugs)

- **Single-dimension bucketing.** Buckets key on `groupBy` only; a spec's
  `group`/`color`/`facet` series fields and `y2` second measure are not
  aggregated — they need a multi-dimension response shape. Bucket rows
  render as a single series.
- **No row-level selection.** `ROW_ID` is synthesised per bucket, so a
  clicked mark selects a bucket index, not a server record.
- **`replicateSummary`/`visibleRows` stats on remote reflect buckets, not
  raw rows** — the endpoint's `totalRows` is the honest figure and the panel
  shows it. Returning `preparedRows`-style group stats (eligible groups,
  minN/maxN) from the endpoint is a cheap follow-up, not built here.
- **Median is exact but memory-heavy** in the reference implementation
  (per-bucket value arrays); a real backend would use an approximate
  quantile.

## Demo

`bun run dev:api` in `packages/table`, then `bun run dev` in
`packages/explorer` — the source menu lists "Experiments API (1M rows,
remote)". CORS on the example API is open, so the explorer dev server needs
no proxy.
