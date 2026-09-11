# Architecture

## Core boundary

The calculation and range packages remain framework-independent. React owns the current reactive input snapshot and delegates calculation and range semantics to the engine.

```text
Renderer / React
    ↓ commands and viewport
Sheet engine
    ├── coordinates and ranges
    ├── cell bindings
    ├── formulas and dependencies
    ├── formats and metadata
    └── input parsing and dependency cleanup
    ↓ resolve / persist
Data adapter
    ├── Postgres record fields
    ├── query results
    └── schema and validation
```

## Table renderer

The table uses one scroll surface with independent TanStack Virtual row and horizontal column virtualisers. Only each visible two-dimensional window plus overscan is mounted; selecting or scrolling through 10,000 rows and wide datasets therefore does not create the Cartesian product of every cell. React 19 uses `useFlushSync: false`, following TanStack's current adapter guidance. Column headers and virtualised row headers are translated to the current scroll position. Cells, editors and the selection outline share the same coordinate geometry, preventing independent layout drift.

The interaction model is separated into pure utilities for movement, range normalisation, TSV transfer, clearing and display evaluation. This makes the core behaviour testable without a browser.

Autofill also lives in this pure layer. It tiles the source rectangle over the destination and shifts relative A1 references while preserving `$A$1`, `A$1` and `$A1` anchors.

Cell formatting uses the same canonical rectangle store as other range metadata. A whole-column format is therefore one indexed range rather than thousands of cell objects. Format snapshots participate in the same undo/redo history as cell inputs.

The renderer accepts frozen and read-only row configuration. Mutation paths share one editability predicate, so direct edits, range clearing, paste and autofill cannot bypass protection. In the demo, the projected dataset-field row is both frozen and protected; schema changes belong in the schema workflow rather than ordinary cell editing.

## Mutations and history

Every committed interaction becomes a labelled `GridMutation` containing only changed cells, format metadata or column widths. Undo applies that mutation backwards; redo applies it forwards. Mutation callbacks form the future persistence, audit and collaboration boundary.

Single-cell operations provide their exact affected addresses and therefore do not scan the sheet. Bulk operations scope the comparison to their affected rectangle. The compatibility path can still derive a mutation from two arbitrary maps when required.

## Sparse cell storage

`CellStore` is a persistent read-only map implemented as copy-on-write overlays. Applying a small mutation creates a small overlay rather than cloning the full sheet. The chain compacts after 64 generations to bound lookup depth. Materialisation occurs only for operations that actually need complete iteration, such as exports or certain bulk transformations.

The benchmark suite covers mutation construction/application against 100,000 populated cells and formula aggregation across 500 cells. Run it with `pnpm bench`.

## Structured data adapter

The worksheet accepts a resolver for `record-field` and `query-result` bindings, so ordinary formulas can calculate over external structured values. `recordWritesForMutation` converts edited bound cells into writes retaining `datasetId`, `recordId` and `fieldId`; sheet-local formulas are deliberately excluded. A concrete API/Postgres integration implements the `DataAdapter` commit contract and returns accepted/rejected writes plus a revision.

`PagedDataAdapter` extends that boundary with viewport-oriented page requests: dataset, query identity, revision, row window and projected field IDs. TanStack's virtual row/column window is exposed through `onViewportChange`, allowing the integration layer to request only visible records and fields plus its chosen prefetch margin.

`DataPageCache` is a bounded LRU. Concurrent requests for the same page share one promise, pages carry their source revision, and datasets can be invalidated independently after writes or query changes.

`ViewportPageLoader` converts arbitrary TanStack windows into stable page-aligned requests and prefetches neighbouring pages. Field projections are deduplicated and sorted so equivalent viewports share cache keys. It owns abort controllers for in-flight work and can cancel them when the consuming view is disposed. `HttpPagedDataAdapter` is the first concrete transport: fetched records hydrate a synchronous binding-value index for formulas, while accepted commits update that index at the returned revision boundary.

`materializeDatasetPage` maps those records onto view coordinates using the page offset and column projection. Every output includes both a display string and a `record-field` binding, retaining dataset, record and field identity. `SpreadsheetHandle.hydrate` installs these cells without creating undo history or pretending a backend load was a user edit. Installing a refreshed binding still invalidates dependent formulas normally.

Sorts and filters are server-side query specifications rather than local rearrangements of a partial viewport. `queryKey` canonicalises property ordering while preserving clause priority, so equivalent query objects share pages. Sort and filter clauses travel with each page request and participate in cache identity.

The table exposes controlled `query` / `onQueryChange` props. Dataset column headers cycle server-side ascending, descending and unsorted states; the imperative handle exposes typed filter addition/removal for a schema-aware shell. The renderer does not locally sort a partially loaded page and present it as the complete dataset.

Writes use optimistic revisions. `RevisionedCommitCoordinator` advances its revision only after an accepted commit. HTTP 409 responses become structured `RevisionConflictError` values containing the current server revision and conflicting record-field writes. The coordinator returns those conflicts to the UI without overwriting the server or retrying silently.

## Cell identity and data identity

A coordinate is a view location, not the durable identity of structured data. `D17` can resolve to `{ datasetId, recordId, fieldId }`, while `F17` may remain a sheet-local formula. Sorting or filtering changes coordinates without changing the underlying record identity.

## Range metadata

Formats and other wide-area properties use disjoint rectangles rather than per-cell objects. Writes:

1. find intersections through an R-tree;
2. remove overlapping rectangles;
3. split and retain their uncovered pieces;
4. insert the last-write-wins rectangle;
5. greedily merge compatible rectangles sharing a complete edge.

This follows the practical architecture publicly described by Equals while remaining an independent implementation.

## Formula roadmap

The evaluator now uses its own tokenizer and recursive-descent parser. It covers arithmetic precedence, powers, unary operators, comparisons, concatenation, strings, booleans, A1 ranges, mixed absolute references and core aggregate/scalar/logical functions. Formula editing offers function and semantic dataset-field completions and highlights resolved dependencies in the grid.

Calculated and externally resolved values are cached. Editing or explicitly invalidating a cell traverses its reverse dependency edges and dirties only the transitive dependent subgraph; unrelated branches retain their cached values. Recalculation can be requested for the complete dirty set or a selected address set.

Dirty cells are scheduled with stable Kahn layers. Dependencies outside the dirty subgraph are treated as already-clean inputs; independent formulas in a layer are serialised together. `recalculateAsync` submits each formula layer through a `FormulaBatchExecutor`, and the browser implementation owns a dedicated module worker. This moves parsing and evaluation off the UI thread while keeping external binding resolution and cache publication on the worksheet boundary. Cycles are reported before a batch is executed.

Formulas are compiled to typed, serialisable ASTs when they are entered, then lowered to compact stack bytecode. Both synchronous calculation and worker batches execute that bytecode, so recalculation no longer repeats tokenisation, parsing or AST traversal. Branch instructions keep `IF` lazy, while lookup, date and aggregate calls share the same worker-safe runtime. Programs contain their expanded dependency list, making graph construction and worker input collection deterministic. Excel compatibility remains test-corpus driven rather than assumed.

`Workbook` owns named worksheets and a qualified dependency graph. References such as `Inputs!B4` and `'Raw Data'!A1:A20` evaluate through their owning sheet while edits invalidate dependent caches across sheet boundaries. A workbook-level evaluation stack detects cycles spanning multiple sheets.

Dynamic-array results are explicit spill matrices. `SpillStore` atomically reserves their coordinates under one anchor, exposes child values, removes obsolete children when dimensions change and rejects occupied destinations with `#SPILL!`. Spill children participate in invalidation but are not independent editable formulas.

Planned order:

1. more lookup and array functions plus Excel compatibility fixtures;
2. spill-aware selection and visual outlines;
3. richer multi-sort, filter-builder and conflict-resolution panels in the surrounding Sheetbase shell;
4. incremental worker program transfer for very large formula populations;
5. asynchronous query and agent functions only behind explicit capability boundaries.

Item 5 is partially delivered: `AsyncFunctionRegistry` (`engine/async-functions.ts`) gates async names behind host-granted capabilities — `QUERYRECORDS` ships under `query:records`. The dispatch point is `createAsyncFormulaExecutor`, a `FormulaBatchExecutor` that routes programs containing a registered async call through the host-side `evaluateBytecodeAsync` and delegates everything else to the normal executor, so sync and async functions compose (`=SUM(QUERYRECORDS("d","f"))`) while workers never see gated names. `createQueryRecordsTransport(adapter, cache)` (`data/query-records.ts`) is the reference transport: `QUERYRECORDS(datasetId, fieldId, [limit])` fetches one page through the host's `PagedDataAdapter` and returns a single-column spill, `#N/A` on an empty result. Requests omit `revision` so identical formulas share one `DataPageCache` entry; when the adapter's revision advances the host calls `cache.invalidateDataset(datasetId)` and `worksheet.invalidate` on every `executor.asyncAddresses()` entry, then re-runs `recalculateAsync`. Invalidation is coarse — whole dataset, all query cells — by design; per-query invalidation is follow-up work.

## Current boundaries

- complete Excel semantics;
- collaborative editing;
- production database endpoint and authentication;
- canvas/WebGL rendering;
- million-row local data materialisation;
- collaborative cursors and conflict resolution;
- merged cells;

Those require stable command, mutation, paging and data-adapter interfaces first.

## Range consolidation

Range reads and overlap discovery use `rbush`. Writes split only intersecting rectangles. Consolidation now starts from rectangles affected by that write and searches their one-cell-expanded spatial neighbourhood for exact-edge peers. Merged rectangles are reconsidered until no compatible neighbour remains. This preserves the Equals-style greedy behaviour without repeatedly scanning every rectangle pair in the store.
