[![CI](https://github.com/phlohouse/sheetbase-table/actions/workflows/ci.yml/badge.svg)](https://github.com/phlohouse/sheetbase-table/actions/workflows/ci.yml)

# Sheetbase Table

An interactive spreadsheet table and headless engine for Sheetbase: Excel-like at the surface, structured-data-native underneath.

The current table includes:

- a 10,000-row viewport with TanStack Virtual driving both visible rows and visible columns;
- single-cell, drag-range, whole-row and whole-column selection;
- arrow, Shift+arrow, Tab, Enter and direct-typing navigation;
- in-cell and formula-bar editing;
- rectangular TSV copy, cut and paste;
- Delete/Backspace clearing and 100-step undo/redo;
- resizable columns and sticky virtualised headers;
- drag autofill for values and formulas, including relative and absolute references;
- range formatting for bold, alignment, currency and percentages;
- contextual formula autocomplete for dataset fields and supported functions;
- live referenced-cell highlighting while editing formulas;
- frozen rows and protected dataset-field headers respected by edit, paste, clear and autofill;
- formula calculation and visible spreadsheet errors.
- a minimal default composition containing only the formula bar, grid and sheet bar;
- independently configurable table sections for embedded, notebook, dataset and workbook contexts.

The framework-independent engine includes:

- coordinate and A1 reference primitives;
- canonical last-write-wins range metadata backed by plain rectangles and `rbush`;
- greedy edge consolidation after overlapping writes;
- typed cell bindings for literals, formulas, record fields and query results;
- a constrained formula evaluator with dependencies, arithmetic and `SUM`;
- circular-reference detection;
- cell-input parsing and dependency cleanup when formulas are replaced.
- a real tokenizer and recursive-descent formula parser—no generated JavaScript evaluation;
- reversible cell, format and column-width mutations;
- persistent sparse cell overlays for sheet-size-independent single-cell edit and undo;
- operational record/query bindings and an adapter boundary for typed database writes.
- cached formula values with transitive dirty-subgraph invalidation;
- stable topological recalculation batches with an actual Web Worker executor;
- typed, serialisable formula ASTs compiled once at edit time;
- compact stack bytecode used by both synchronous and worker evaluation;
- named-sheet references with workbook-wide invalidation and cycle detection;
- dynamic `SEQUENCE` spills with ownership, replacement and `#SPILL!` collision handling;
- locally indexed range consolidation rather than global rectangle scans;
- viewport-driven paged data contracts and an LRU cache with request de-duplication.
- an HTTP paged-data adapter and aligned viewport page loader with prefetch and cancellation.
- immediate empty-grid rendering, requested-cell loading placeholders, split load timings and adapter-scoped page reuse.
- field- or range-targeted conditional formatting with text, numeric, interval and blank-value rules.
- page-to-grid materialisation that preserves dataset, record and field identity.
- canonical server-side sort/filter queries and optimistic revision conflict coordination.

## Run it

```bash
bun install
bun run test
bun run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

Run the repeatable performance suite with `bun run bench`.

## Million-row paged example

The simplest option is to launch both persistent processes in a labelled Herdr workspace:

```bash
bun run dev:herdr
```

This creates separate `API · :8787` and `Table · :5173` tabs, focuses the new workspace, and refuses to replace an existing process on either port. Herdr must already be running.

Run the synthetic API and the Vite app in separate terminals:

```bash
bun run dev:api
bun run dev
```

Then open `http://localhost:5173/million`. The example exposes one million logical records through page-aligned viewport requests, server-side sorting/filtering, typed updates, blank-row record creation and optimistic revision conflicts. `POST /api/table/conflict` advances the server revision so the next edit demonstrates the visible conflict path. (The legacy `/?paged=1` URL redirects to `/million`.)

The browser uses Vite's same-origin `/api/table` proxy, so it does not need direct access to the Bun port. This also avoids WSL localhost-forwarding and cross-origin differences between browsers.

Vite listens on all WSL interfaces. If Windows does not forward `localhost`, run `hostname -I | awk '{print $1}'` in WSL and open `http://<that-address>:5173/million` instead.

## Table controls

| Action | Control |
| --- | --- |
| Move | Arrow keys |
| Extend selection | Shift + arrow keys |
| Edit active cell | Enter, F2, double-click or type |
| Commit edit | Enter or Tab |
| Cancel edit | Escape |
| Copy / cut / paste | Standard platform shortcuts |
| Clear range | Delete or Backspace |
| Undo / redo | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y |
| Select row / column | Click its header |
| Resize column | Drag the right edge of its header |
| Sort dataset column | Click the sort control in its column header; cycles ascending, descending and clear |
| Autofill | Drag the violet handle at the selection's lower-right corner |
| Format range | Select cells and use the toolbar controls |

Supported calculation functions currently include `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `XLOOKUP`, `MATCH`, `ROUND`, `ABS`, `SQRT`, `AND`, `OR`, `NOT`, `DATE`, `YEAR`, `MONTH`, `DAY`, `TODAY` and spill-producing `SEQUENCE`. The engine supports arithmetic precedence, comparisons, concatenation, cross-sheet A1 ranges and mixed absolute references such as `$A1`, `A$1` and `$A$1`.

## Direction

Sheetbase Table is not intended to be an Excel clone or a wrapper around a generic data grid. A visible cell may bind to a real database record field, a query result, a sheet-local literal, or a formula. This allows ordinary spreadsheet editing while preserving types, record identity, validation, provenance and audit at the data layer.

See [docs/architecture.md](docs/architecture.md), [docs/components.md](docs/components.md), [docs/accessibility.md](docs/accessibility.md) and [docs/design.md](docs/design.md).
