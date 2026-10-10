# sheetbase-studio (single binary)

Sheetbase Studio as one executable: the Studio UI plus a DuckDB-backed server for files, SQLite, DuckDB, Postgres and MySQL. Nothing to install — no Python, Node or database drivers — and nothing is downloaded at runtime, so it works offline and on locked-down machines.

```bash
sheetbase-studio runs.parquet plates.csv           # files (or folders of them)
sheetbase-studio --db lims.sqlite                  # a SQLite or DuckDB file
sheetbase-studio --db lims=postgres://reader@db.lab/lims --table qc.assays
sheetbase-studio --db mysql://reader@mysql.lab/qc
```

It opens your browser at `http://127.0.0.1:8765/`. People can also drag more files onto the page or use **Open file…**; those uploads go to the binary's DuckDB, not the browser.

For pandas or Ibis objects, or warehouses DuckDB can't reach (Snowflake, BigQuery), use the Python package instead (`python/`, `sheetbase.explore(df)`).

## Data

| Source | How | Notes |
| --- | --- | --- |
| CSV, TSV | file or folder | loaded into DuckDB |
| Parquet | file or folder | read in place (a view), so large files open instantly |
| JSON / NDJSON, Excel (.xlsx) | file or folder | one table per Excel sheet |
| SQLite (`.sqlite`, `.db`, `sqlite://`) | `--db` | read-only |
| DuckDB (`.duckdb`, `duckdb://`) | `--db` | read-only |
| Postgres (`postgres://`, `postgresql://`) | `--db` | read-only, via DuckDB's postgres connector |
| MySQL / MariaDB (`mysql://`) | `--db` | read-only, via DuckDB's mysql connector |

`--db` is repeatable; name a database with `name=<url>`. `--table` (repeatable) picks tables by `name`, `schema.name` or `alias.schema.name`. Database tables appear under SQL-friendly names — `assays`, or `qc_assays` when the chosen tables span several schemas — and the same names work in the SQL editor. Their row counts are taken on first use, so connecting to a large database stays fast.

## Security

- **Read-only.** Databases are attached read-only (Postgres sessions run in read-only transactions), and the SQL editor runs one `SELECT`/`WITH` query.
- **Locked down after startup.** Once the named files and databases are open, DuckDB can't read other files, reach the network, attach anything else or change its settings — so SQL can't read `/etc/passwd`, fetch a URL or write a file.
- **Localhost by default.** The server listens on `127.0.0.1` and only answers requests addressed to `localhost`/`127.0.0.1` (blocking DNS-rebinding attacks from web pages). With `--host` beyond localhost an access token is always required; share the printed link only with people who should see the data.
- **`--table` narrows the list, not access.** SQL can read any table the connection's role can read (including through `postgres_query()`), so connect with a role scoped to what you want shared.

## Options

```
--host <host>      interface (default 127.0.0.1)      --no-browser   don't open a browser
--port <port>      port (default 8765, or next free)  --no-sql       hide the SQL editor
--token            require an access token            --no-upload    no uploads from the browser
--max-upload <MB>  largest upload (default 2048)      --cors         allow cross-origin requests
```

## What's inside

| Part | Source |
| --- | --- |
| Runtime | Bun (`bun build --compile`) |
| UI | `@sheetbase-labs/sheetbase-studio` standalone build |
| Data layer | Studio's `DuckDbSource` / `DuckDbSqlSource` — the same SQL and filter compiler the browser uses, checked by the shared filter-parity cases |
| DuckDB | `@duckdb/node-bindings-<platform>` from npm (integrity-verified) |
| Connectors | `duckdb-extension-{sqlite,postgres,mysql}-scanner` from PyPI — DuckDB's official builds, SHA-256-verified |

DuckDB and the connectors are embedded gzipped and unpacked once per build into the user cache (`~/.cache/sheetbase-studio`, `~/Library/Caches/sheetbase-studio` or `%LOCALAPPDATA%\sheetbase-studio\Cache`; override with `SHEETBASE_CACHE_DIR`). A connector is only unpacked the first time it's used. Binaries are about 125–140 MB.

The native DuckDB is pinned to the newest release that has connector builds on PyPI (currently 1.5.5); bump `@duckdb/node-api` here and in `packages/studio` together when newer connectors are published.

## Development

```bash
bun run --filter sheetbase-studio-cli fetch:natives   # DuckDB binding + connectors for this machine (.cache/)
bun run --filter sheetbase-studio-cli build:ui        # Studio UI → .build/ui
bun run --filter sheetbase-studio-cli dev -- data.csv --db lims.sqlite
bun run --filter sheetbase-studio-cli test            # unit, server, lockdown and parity tests
SHEETBASE_TEST_POSTGRES=postgresql://… SHEETBASE_TEST_MYSQL=mysql://… bun run --filter sheetbase-studio-cli test
bun run --filter sheetbase-studio-cli build:binary            # this platform → dist/
bun run --filter sheetbase-studio-cli build:binary -- --all   # linux_amd64 linux_arm64 osx_arm64 osx_amd64 windows_amd64
bun run --filter sheetbase-studio-cli smoke           # start the built binary and check it end to end
```

CI builds all five platforms, smoke-tests Linux, macOS (Apple Silicon) and Windows on their own runners, and runs the binary against Postgres 16 and MySQL 8.4. Tagged releases attach the binaries (`.tar.gz`/`.zip`) and `SHA256SUMS.txt` to the GitHub release.

macOS binaries aren't notarised: a downloaded copy may need `xattr -d com.apple.quarantine sheetbase-studio` before the first run.
