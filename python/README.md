# sheetbase-studio (Python)

Explore pandas, polars, pyarrow and Ibis tables — or a whole database — in
Sheetbase Studio. The UI is the same `@sheetbase-labs/sheetbase-studio`
component the web apps use; every query runs in Python through
[Ibis](https://ibis-project.org), so the same code explores an in-memory
DataFrame, a DuckDB or Parquet file, or Postgres/Snowflake/BigQuery tables.

```bash
pip install "sheetbase-studio[widget]"     # add [excel] for .xlsx uploads
```

## In a notebook

```python
import sheetbase

sheetbase.explore(df)                                    # one DataFrame
sheetbase.explore(runs=df, plates=con.table("plates"))   # several tables, any Ibis backend
```

`explore` returns an [anywidget](https://anywidget.dev) (`sheetbase.Studio`),
so it works in Jupyter, JupyterLab, VS Code and marimo. Requests travel over
the widget's comm channel to the kernel — rows never leave Python except as
the pages, buckets and profiles the UI asks for. `studio.add(name, data)` adds
a table to an open Studio.

## In the browser

```python
sheetbase.serve(df)                      # http://127.0.0.1:8765/
sheetbase.serve(runs=df, block=False)    # keep using the REPL
```

```bash
sheetbase serve runs.parquet plates.csv
sheetbase serve --db postgres://me@db/lims --table assays --table batches
sheetbase serve --db duckdb://warehouse.duckdb --host 0.0.0.0 --token
```

The server binds to localhost. With `--token` (or `serve(token=True)`) every
request needs the printed token; always use it with a non-local `--host`.

## What runs where

| Studio operation | Python |
|---|---|
| Field profiles (missing, distinct, quantiles, top values, bins) | one Ibis aggregate per table + per-field top values and bins |
| Charts | `group_by().aggregate()`; histograms bin in SQL; scatter/box/violin draw a seeded sample |
| Filters | `sheetbase.compile_filter` — the filter tree as an Ibis expression |
| Rows | `filter → order_by → limit/offset`, at most 5,000 rows a page |
| SQL | read-only, see below; the result opens as a new table |
| Uploads | CSV/TSV (pyarrow), Parquet, JSON/NDJSON, Excel (openpyxl) |

Tables of up to 50,000 rows are pulled into the browser once and explored
there; larger tables stay in Python and every interaction is a query.

## Reproduce a view in code

The Studio's **SQL** tab shows the current view as SQL, Ibis and pandas.
For exact Studio semantics (null handling, loose text/number matching, NOT as
"none of"), apply a saved view or a provenance file's `view` directly:

```python
from sheetbase import apply_view

subset = apply_view(con.table("assays"), provenance["view"]).to_pandas()
```

`compile_filter(tree, table)` returns just the boolean expression.

## Read-only SQL

User SQL must be a single `SELECT`/`WITH` query over tables in the Studio's
catalog. Before anything runs, sqlglot rejects DDL/DML, `COPY`, `ATTACH`,
`PRAGMA`, `SET`, file and URL table functions (`read_csv`, `read_parquet`, …)
and qualified names outside the catalog. The private DuckDB that holds
in-memory data has external file and network access switched off. For
database tables, connect with a read-only role as well — defence in depth.

## Semantics and parity

Filters follow `buildPredicate` in `@sheetbase-labs/sheetbase-shared`. The
cases in `packages/studio/fixtures/filter-parity.json` run against this
package (pytest), the in-browser DuckDB compiler, and — with
`SHEETBASE_PYTHON` set — a live server from the TypeScript test suite, so the
three executors return the same rows.

Datetimes without an offset are read as UTC. Date-only strings are UTC
midnight.

## Developing

```bash
bun install && bun run --filter @sheetbase-labs/sheetbase-studio build:python   # UI → src/sheetbase/static
uv venv && uv pip install -e "python[dev]"
pytest python
SHEETBASE_PYTHON=.venv/bin/python bun run --filter @sheetbase-labs/sheetbase-studio test
```

The built UI is not committed; wheels built in CI include it. An install
without it serves the API and a note explaining how to build the UI.
