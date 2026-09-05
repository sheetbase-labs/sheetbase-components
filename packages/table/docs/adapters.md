# Paged data adapters

`PagedSpreadsheet` connects the reusable grid to a server-paged dataset while keeping record identity and optimistic revisions intact.

```tsx
import { HttpPagedDataAdapter, PagedSpreadsheet } from "sheetbase-table";
import "sheetbase-table/styles.css";

const adapter = new HttpPagedDataAdapter("/api/table");

<PagedSpreadsheet
  adapter={adapter}
  datasetId="experiments"
  fieldIds={["experiment_id", "assay", "result", "status"]}
  rowCount={1_000_000}
  columnCount={4}
  datasetHeader={{ fields }}
  showLoadStatus
  showLoadTimings={false}
/>
```

The HTTP adapter uses these endpoints:

- `GET /pages` receives dataset, row-window, fields, sort and filter query parameters.
- `POST /commits` receives identity-preserving field writes and `baseRevision`.
- `POST /records` receives `datasetId`, initial field values and `baseRevision`.

Accepted pages hydrate cells without creating undo entries. User edits retain `{datasetId, recordId, fieldId}` identity. HTTP `409` responses become visible conflict states and are never silently overwritten.

The renderer mounts the complete empty viewport immediately, marks only requested cells with subtle loading placeholders, and can report loaded versus total rows. Set `showLoadStatus={false}` to remove the pill entirely. `showLoadTimings` separately exposes page/API, worksheet hydration and browser render timings and defaults to `false`. The initial request does not prefetch neighbouring pages; prefetch begins only after the first page has painted. Page caches are shared by adapter instance, so returning to a previously viewed sheet can reuse its first page without another request. Pass an explicit `pageCache` when several independently-created adapters should share the same cache.

Use `Spreadsheet` directly for local or fully controlled data. Use `PagedSpreadsheet` when the server owns paging, sorting, filtering and revisions.

## Presentation persistence

`TablePresentationAdapter` is the presentation-state boundary. `load` may return a promise when state must be fetched from a server; `useTablePresentationState` renders the fallback first and swaps in the loaded state when it resolves.

`createHttpPresentationAdapter(baseUrl)` implements the boundary over one endpoint:

```tsx
import { createHttpPresentationAdapter, useTablePresentationState } from "sheetbase-table";

const adapter = createHttpPresentationAdapter("/api/presentation");
const [presentation, setPresentation] = useTablePresentationState(key, fallback, adapter);
```

- `GET {baseUrl}?key={key}` returns the stored state (`404` means none saved).
- `PUT {baseUrl}` receives `{ key, state }` JSON.

The example stores presentation state per user in a SQLite file (`presentation.db`) via `GET/PUT /api/presentation`; the demo passes `?user=<name>` to scope its storage key. Hosts should replace it with database-backed persistence keyed by user and dataset. Persistence stays idle-scheduled and never reintroduces named views.

## Versioned schema migrations

`TablePresentationState` is versioned. `normalisePresentationState` runs `migratePresentationState` before structuring, which:

- replays registered `registerPresentationMigration({ from, to, migrate })` steps while the stored version is older than `CURRENT_PRESENTATION_VERSION`;
- discards state written by a newer library version (it falls back rather than misreading unknown fields).

When the stored schema changes, bump `CURRENT_PRESENTATION_VERSION`, register a migration from the previous version, and cover it with a unit test.

## Runnable Bun example

`examples/million-row-api.ts` implements the complete contract over one million deterministic records. Start it with `bun run dev:api`, start Vite with `bun run dev`, and open `/million`.

The unfiltered path generates only the requested page. Filtered and sorted requests deliberately perform server work so it is clear that the browser never treats a loaded page as the complete dataset. In production, the same request contract maps naturally to indexed Postgres queries with `LIMIT`, keyset/offset pagination and an application-managed revision or row-version column.

`PagedSpreadsheet` reports backend totals through `onTotalRowsChange`, clears row-to-record identities when query state changes, and hydrates the durable record ID returned after blank-row creation. The semantic column header is synchronously anchored with scroll-position CSS variables, so it remains at the top even while React virtualisation catches up with a fast scroll.


The example API implements the complete filter contract: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `in`, `between` (two-element value array), `isNull`, `notNull` and `withinLastDays` (relative date window). Production adapters should translate these to indexed SQL predicates rather than materialising rows.
## Conditional formatting

Conditional formatting is configuration, not hard-coded knowledge in the renderer. Rules can target a semantic `fieldId`, a coordinate `range`, or both. Later rules override only the format properties they specify.

```tsx
<PagedSpreadsheet
  conditionalFormats={[
    { fieldId: "status", operator: "equals", value: "Review", format: { foreground: "#8a5a00" } },
    { fieldId: "status", operator: "equals", value: "Flagged", format: { foreground: "#a23131", fontWeight: 500 } },
    { fieldId: "result", operator: "greaterThan", value: 90, format: { background: "#fff1f1" } },
  ]}
  {...props}
/>
```

Supported operators are `equals`, `notEquals`, `contains`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `between`, `isBlank` and `isNotBlank`. Direct range formatting remains the base; matching conditional properties take precedence while their condition is true.
