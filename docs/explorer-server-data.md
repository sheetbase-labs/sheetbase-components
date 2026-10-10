# Explorer server data path (spike)

The explorer charts whatever fits in memory: `DataAdapter.load()` returns a materialised `Dataset { rows }`, and the only built-in sources are the sample dataset and a whole-file reader. This spike adds the contract that lets the explorer chart datasets that stay on the server — the same Postgres-shaped data the table pages over.

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

- `filter` — the plan-008 `GroupNode` tree, evaluated with `buildPredicate` semantics (NOR `NOT`, date-aware comparisons). It is authoritative; a server should not also apply a flat `filters` list.
- `groupBy` — the field whose distinct values become buckets; the chart's x channel.
- `seriesBy` — optional additional statistical dimensions (the spec's `group`/`color`/`facet`, deduped, excluding `groupBy`). When present, buckets key on the `(groupBy × seriesBy)` tuple and each bucket reports its series values in `series` — mirroring how client-side `preparedRows` groups on the same tuple. A server that ignores `seriesBy` returns single-dimension buckets; the client still renders them, as one flat series.
- `summary` — `mean | median | sum | count | min | max`.
- `valueField` — the measure; required for every summary except `count`.
- `limit` — cap on returned buckets (applied after a deterministic key-ascending then series-ascending sort; it truncates (key × series) pairs, so a high-cardinality series field can starve later keys).

Response (`AggregateResponse`):

```json
{
  "buckets": [{ "key": "Complete", "series": { "reviewer": "Alice" }, "count": 333334, "value": 49.87 }],
  "totalRows": 1000000,
  "revision": "r12"
}
```

`series` is present only on multi-dimension responses and maps each `seriesBy` field to its value for that bucket, in request order.

`totalRows` counts matching rows *before* bucketing — it is what the bottom panel's row count reports.

POST+JSON rather than GET+params because a filter tree is bulky and structured; the commits route already sets that precedent.

### Client: `Dataset.remote`

`Dataset` gains an optional capability:

```ts
remote?: {
  aggregate(query: AggregateQuery, signal?: AbortSignal): Promise<AggregateResponse>
  page?(query: RemotePageQuery, signal?: AbortSignal): Promise<RemotePage>
}
```

`createHttpExplorerAdapter({ baseUrl, datasetId, fields })` (`lib/adapters/http.ts`) returns a `DataAdapter` whose `load()` resolves immediately to a metadata-only dataset — `rows: []`, caller-supplied column metadata, and the bound `remote`. No schema endpoint is required; a real backend could add `GET /api/explorer/schema` later without changing the contract.

`remote.page` is wired to `GET {baseUrl}/api/table/pages` — the same paged rows endpoint the table's HTTP adapter uses (`rowStart`, `rowCount`, `fieldIds`, `filterTree` params; `{ records, totalRows, revision }` response). When a remote dataset offers it, the Data tab shows the first 200 rows in the shared `DataGrid` under a "the rest stay on the server" strip, filtered by the active view; when it doesn't, the tab keeps the plain remote note.

`bucketsToRows` shapes each bucket into the same row `preparedRows` emits for a client-side aggregate: `{ [groupBy]: key, ...series, [valueField]: value, __sheetbaseCount: count, __sheetbaseRowId: i }` — series values land under their own field names, so `group`/`color`/`facet` chart channels pick them up unchanged. The chart is then built with `aggregate: 'none'` so `preparedRows` passes bucket rows through untouched — downstream code barely notices the data came from a server.

## What goes remote, what doesn't

A spec goes remote when `chartSpec.aggregate !== 'none'` and the chart kind consumes aggregated rows — bar, horizontal-bar, pie, donut, line, area, scatter-with-aggregate, lollipop, waterfall. These are exactly the specs for which `preparedRows` groups+summarises.

Raw-row specs can't be served by this contract: `aggregate === 'none'`, histogram, box, violin, and heatmap always draw distributions of raw rows. On a remote source these show an explicit note ("pick an aggregate…") instead of an empty chart — the honest answer rather than a silent cap.

On remote datasets the bottom panel's data table becomes a first-page preview (when `remote.page` is wired) and the SQL workspace keeps the remote note: alasql runs in a worker over materialised rows and cannot see a remote dataset. Pushing SQL server-side is out of scope.

## Loading and failure UX

- While the first aggregate is in flight the chart stage shows a spinner with "Aggregating on the server…"; a spec change keeps the previous buckets visible and swaps when the new response lands (stale-while-revalidate).
- A failed aggregate renders "Aggregation failed: …" with a **Retry** button that re-fires the request; a failed row preview gets its own Retry in the Data tab.

## Correctness properties

- **Filters apply once.** The shared view's tree is sent intact; flat spec filters are rebuilt into a tree first. Bucket rows are never re-filtered client-side (they don't carry the original fields).
- **Stale responses can't win.** Each spec/source change aborts the in-flight request (`AbortController`), and a response is only applied if its dataset is still the active one — the same discipline as the SQL pane's generation guard.
- **Remote markers don't leak into persistence.** `PersistedExplorerState` holds spec/sql/theme/saved — never the dataset — so a `remote` flag can't be restored into a session that lacks the adapter.

## Known limitations (documented, not bugs)

- **No second measure.** A spec's `y2` is not aggregated remotely — client-side `preparedRows` keeps the first raw row's `y2`, so "correct" remote parity is itself ambiguous and deferred.
- **Servers without `seriesBy` degrade silently.** Older/simpler endpoints return single-dimension buckets and grouped specs render as one flat series — plausible-looking but wrong. A `capabilities` echo on the response is a candidate follow-up.
- **No row-level selection.** `ROW_ID` is synthesised per bucket, so a clicked mark selects a bucket index, not a server record.
- **`replicateSummary`/`visibleRows` stats on remote reflect buckets, not raw rows** — the endpoint's `totalRows` is the honest figure and the panel shows it. Returning `preparedRows`-style group stats (eligible groups, minN/maxN) from the endpoint is a cheap follow-up, not built here.
- **Median is exact but memory-heavy** in the reference implementation (per-bucket value arrays); a real backend would use an approximate quantile.

## Demo

`bun run dev:api` in `packages/table`, then `bun run dev` in `packages/explorer` — the source menu lists the experiments API (250k rows under the default `API_ENGINE=sql`, one million under `API_ENGINE=memory`). CORS on the example API is open, so the explorer dev server needs no proxy.
