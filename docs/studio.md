# Studio — design record

What Sheetbase Studio is for, the decisions behind it, and what is
deliberately left out. Usage lives in `packages/studio/README.md` and
`python/README.md`.

## Goal

Scientists often open a dataset without knowing what is in it. Studio makes
the first ten minutes productive — what columns exist, how complete they are,
how values distribute, what a filter does to the rest — and lets power users
slice with SQL, against any upstream: rows a host already has, an uploaded
file, an API, a database, or a pandas/Ibis object in Python.

## Decisions (October 2026)

| # | Question | Decision |
|---|---|---|
| 1 | In-browser engine | **DuckDB-WASM**, lazily loaded; replaces alasql inside the studio. Same SQL dialect as the Python/DuckDB side, reads Parquet, scales past memory-sized rows. |
| 2 | Python delivery | **Both** a standalone server (`sheetbase serve`) and a notebook widget (anywidget), sharing one backend and one route dispatcher. |
| 3 | Where Python lives | **This repo** (`python/`), so CI runs the shared filter-parity fixture against it. |
| 4 | Raw SQL against databases | **Allowed, read-only**: one SELECT/WITH over catalogued tables, checked before it runs; DuckDB external access off; use read-only database roles too. |
| 5 | Raw-row charts on remote data | **Both**: exact server-side histograms, and seeded samples (clearly labelled) for scatter, box, violin and heatmap. |
| 6 | Schema editor | **Left out** of v1. |
| 7 | Name | **Sheetbase Studio** (`@sheetbase-labs/sheetbase-studio`, `sheetbase-studio` on the Python side). |

## Shape

```
StudioDataSource (shared/source.ts)
  ├─ MemorySource ── JS (buildPredicate)          ─┐
  ├─ DuckDbSource ── DuckDB-WASM (filterToSql)     ├─ same filter semantics,
  └─ HttpSource ──── any server speaking the wire ─┤  pinned by
        ├─ sheetbase serve ── Ibis (compile_filter)│  filter-parity.json
        └─ notebook widget ── comm → same backend ─┘

SheetbaseStudio
  └─ Workspace (per table)
       ├─ useWorkbench: one AnalysisView ⇄ DatasetQuery
       ├─ Fields   (profiles from the source, or computed locally)
       ├─ Chart    (explorer; remote capabilities when the table stays at source)
       ├─ Filters  (advanced search)
       ├─ Rows     (PagedSpreadsheet, read-only)
       └─ SQL      (source.sql → new query table; view as SQL/Ibis/pandas)
```

**Local or at source.** A table with a known row count at or below
`materialiseLimit` (50,000) is paged into the browser once; everything else
stays at the source. The UI says which (*at source*), so sampled charts are
never mistaken for complete ones.

**Read-only throughout.** No source writes back; the rules engine (the write
path) is not part of Studio.

**Provenance.** Exports carry the source, table (with the SQL that made a
query table), filter tree, chart spec, readable SQL and matching row count —
enough to reproduce or audit a figure. `sheetbase.apply_view` reproduces the
view on an Ibis table with exact semantics.

## Known limits and follow-ups

- **Saved views** remain the design in `docs/saved-views.md`; Studio persists
  the current view and chart per table in local storage only.
- **Datetimes without an offset** are read as UTC on the server and in DuckDB;
  the browser's `buildPredicate` reads them in local time. ISO strings with
  `Z` (what every source emits) agree everywhere.
- **Mixed-type text columns**: DuckDB and Ibis casts are stricter than JS
  `Number()`/`Date.parse` for exotic forms (hex, slashed dates).
- **Samples** on the Python side are seeded Bernoulli samples capped at *n*;
  very small filtered sets can return slightly fewer than *n* rows.
- **Wide tables**: profiles cover the first 200 fields.
- **No live JupyterLab test** in CI yet: the widget's kernel side is tested in
  pytest and its front end against the HTTP API with a model double.
