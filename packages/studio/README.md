# Sheetbase Studio

Explore and chart any table. Studio puts the Sheetbase components around one
shared view so a scientist can find out what a dataset holds before they know
what to ask of it, and a power user can drop to SQL without leaving the page:

- **Fields** — every column profiled: missing values, distinct count,
  quantiles, range, most frequent values and a distribution. Hints flag
  mostly-empty, constant and unique-per-row columns. Click a value or a bin to
  filter on it; *Chart it*, *As x*, *As y* and *Colour by* drive the chart.
- **Chart** — the explorer, controlled by the studio.
- **Filters** — the advanced search builder (AND / OR / NOT).
- **Rows** — the read-only paged grid.
- **SQL** — read-only queries whose results open as new, explorable tables,
  plus the current view written as SQL, Ibis and pandas.

All five panes follow the same `AnalysisView`, so a click in one re-filters the
others. Every chart can be exported as SVG with its **provenance** embedded
(source, table, the SQL behind a query table, filter tree, chart spec, matching
row count); the top bar's *Provenance* button saves the same record as JSON.

```tsx
import { SheetbaseStudio, MemorySource } from "@sheetbase-labs/sheetbase-studio";
import "@sheetbase-labs/sheetbase-studio/styles.css";

const source = new MemorySource({ tables: [{ id: "runs", label: "Bioreactor runs", rows }] });

<SheetbaseStudio sources={source} />
```

Peers: `react`, `react-dom` and `@tanstack/react-virtual` (the grid). Like the
other packages it renders inside `.sheetbase-scope` and reads only theme
variables, so a host retheme applies. Uncontrolled, it follows the OS (or
notebook) light/dark setting until the user toggles it — pass `defaultTheme`
to start elsewhere, or `theme` + `onThemeChange` to own it.

## Sources

A source is anything that implements `StudioDataSource` from
`@sheetbase-labs/sheetbase-shared`: a catalog of tables plus `page`,
`aggregate`, and optionally `profile`, `histogram`, `sample`, `sql` and
`upload`. Every operation runs where the data lives; the UI only ever receives
pages, buckets, profiles, bins and samples. Pass one source or several — the
table picker groups tables by source.

| Source | For | Executes |
|---|---|---|
| `MemorySource` | rows the host already has | JavaScript (the reference semantics); SQL and uploads hand over to an in-browser DuckDB started on first use |
| `DuckDbSource` | files and large local data | DuckDB-WASM in a worker |
| `createHttpSource({ baseUrl })` | your API, or `sheetbase serve` | the server |
| `HttpSource.connect(transport)` | anything else that can carry a request (the notebook widget uses its comm) | the other end |

Files (CSV, TSV, JSON/NDJSON, Excel, Parquet) can be dropped anywhere on the
studio or opened from the top bar. They go to the first source that accepts
uploads, otherwise into an in-browser DuckDB.

### Small tables come local, large ones stay put

Tables with at most `materialiseLimit` rows (default 50,000) are pulled into
the browser once: profiles are instant and box, violin and heatmap charts use
every row. Larger tables — and any table whose row count the source can't give
cheaply — stay at the source, and the top bar says so (*at source*). There:

- aggregated charts (bar, line, pie, …) aggregate at the source;
- histograms use exact bins from the source;
- scatter, box, violin and heatmap draw a seeded random sample of 5,000
  matching rows, with a strip saying how many rows the sample stands for;
- profiles and the matching-row count come from the source and follow the
  filter (or all rows — the *Filtered / All rows* switch).

### Offline and locked-down deployments

DuckDB-WASM loads its worker and `.wasm` from jsDelivr by default. To serve
them yourself (air-gapped labs, GxP systems), import them with Vite's `?url`
and pass the bundles:

```ts
import mvpModule from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehModule from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

<SheetbaseStudio wasm={{ bundles: { mvp: { mainModule: mvpModule, mainWorker: mvpWorker }, eh: { mainModule: ehModule, mainWorker: ehWorker } } }} … />
```

Ingestion never needs a DuckDB extension: rows and JSON load through DuckDB's
built-in CSV reader, Excel is parsed in JavaScript, and Parquet falls back to
a pure-JS reader (`hyparquet`) when DuckDB's Parquet extension can't be
fetched. Nothing is downloaded until someone opens a file or runs SQL.

## The wire contract

`HttpSource` speaks the routes the table and explorer already use, plus a few
under `/api/studio` (all JSON; errors are non-2xx with `{ error }`):

| Route | Body / params | Response |
|---|---|---|
| `GET /api/studio/catalog` | — | `{ source, capabilities, tables: TableInfo[] }` |
| `GET /api/table/pages` | `datasetId`, `rowStart`, `rowCount`, `fieldIds`, `sort`, `filters`, `filterLogic`, `filterTree` | `{ records, totalRows, revision? }` |
| `POST /api/explorer/aggregate` | `{ datasetId, ...AggregateQuery }` | `{ buckets, totalRows }` |
| `POST /api/studio/profile` | `{ datasetId, fields, filter?, bins?, top? }` | `{ totalRows, profiles: FieldProfile[] }` |
| `POST /api/studio/histogram` | `{ datasetId, field, bins?, binWidth?, by?, filter? }` | `{ edges, series, totalRows, nulls }` |
| `POST /api/studio/sample` | `{ datasetId, fields, n, filter?, seed? }` | `{ rows, totalRows, sampled }` |
| `POST /api/studio/sql` | `{ sql }` | `TableInfo` of the new query table |
| `POST /api/studio/upload` | multipart `file` | `{ tables: TableInfo[] }` |

Types are in `@sheetbase-labs/sheetbase-shared` (`source.ts`). Rows are plain
JSON: numbers, booleans, strings, ISO dates (`2026-03-15`) and datetimes
(`2026-03-15T08:30:00.000Z`).

The [`sheetbase-studio` Python package](../../python/README.md) implements the
contract over Ibis, so pandas, polars, Parquet files and Postgres/Snowflake/
BigQuery tables all explore the same way — in the browser (`sheetbase serve`)
or as a notebook widget (`sheetbase.explore(df)`).

## One filter semantics, three executors

Filters are `FilterNode` trees with `buildPredicate` semantics (loose
equality, NULL handling, `NOT` = none of). They are executed by:

- `MemorySource` — `buildPredicate` itself;
- every DuckDB source — `filterToSql` (`src/lib/sql-compile.ts`), which picks
  the same comparison arm per column type and value type and keeps every
  condition NULL-free so `NOT` can't flip;
- the Python package — `sheetbase.compile_filter`, the same rules over Ibis.

`fixtures/filter-parity.json` pins them together: 70+ cases run against
DuckDB here, in the Python tests, and through a live Python server when
`SHEETBASE_PYTHON` is set (`src/sources/python.test.ts`). Regenerate it after
changing the cases with `bun run parity`.

`filterToSql(tree, types, { mode: "readable" })` gives the hand-written
version shown in the SQL pane; `viewToSql`, `viewToIbis` and `viewToPandas`
write the whole view.

## Read-only SQL

SQL must be one `SELECT` / `WITH` query. In the browser it runs as
`CREATE TEMP VIEW … AS (<query>)`, which DuckDB only accepts for a query, so
DDL, DML and a second statement fail to parse rather than run. The Python
server checks queries with sqlglot first (see its README). Results register as
`query_N` tables in the catalog and can be filtered, profiled, charted and
joined by later queries.

## Development

```bash
bun run dev:studio                       # demo on :5204 with sample bioprocess data
open "http://localhost:5204/?remote=1"   # same data, every table kept "at source"
open "http://localhost:5204/?server=http://127.0.0.1:8765"   # add a `sheetbase serve`
bun run --filter @sheetbase-labs/sheetbase-studio test
bun run --filter @sheetbase-labs/sheetbase-studio build:python   # UI for the Python package
```

Tests run the DuckDB compiler and sources against native DuckDB
(`@duckdb/node-api`) — the same SQL the WASM engine runs in the browser.
