# @sheetbase-labs/sheetbase-rulesengine

Natural-language pipeline rules with a dry-run tester. Conditions evaluate through `@sheetbase-labs/sheetbase-shared` (`toFilterClause` / `testCondition` / `filterRows`).

```bash
bun install
bun run dev:rules   # http://localhost:5202/
```

```tsx
import { RulesEngine, parseNaturalLanguageRule, matchRules } from "@sheetbase-labs/sheetbase-rulesengine"
import "@sheetbase-labs/sheetbase-rulesengine/styles.css"
```

## Action kinds — component semantics vs host semantics

`RuleActionKind` is an open string; the host declares the vocabulary via the
`actions` prop. The engine evaluates every action during dry run, but only
`transform` produces a local effect. On apply, `ruleWritesForRows` turns
transform effects into `RuleWrite[]` and `onApplyWrites` hands them to the
host's commit boundary — the component proposes, the host disposes.

| kind | dry run | apply | what a host pipeline does with it |
|---|---|---|---|
| `transform` | computes `transforms` + rewritten `output` | emits `RuleWrite`s (`recordId`/`fieldId`/`before`/`after`); last transform per field wins | commits them as field writes (e.g. `PagedDataAdapter.commit`, which adds `datasetId` and returns accepted/rejected) |
| `reject` | marks the row `rejected` | row is excluded from writes and counted in `plan.rejected` | drops/quarantines the row before further stages |
| `flag` | collects `flags` (detail or rule name) | reported only — produces no writes | attaches review metadata to the record |
| `route` | collects `routes` (target queue/stage) | reported only — produces no writes | moves the record to the named queue/stage |
| `notify` | collects `notifications` | reported only — produces no writes | delivers the detail to a webhook/queue |

Notes for hosts:

- `recordIdOf(row, index)` maps a dry-run row back to its record id; matched
  rows it can't resolve are counted as `skipped`, never silently written.
- The demo workbench commits writes through `createMemoryPagedAdapter`,
  invalidates the shared page cache, and remounts the table pane to re-read —
  that remount is the spike's refresh mechanism, not a product pattern. A real
  host would push the new revision into its own cache-invalidation flow.
- Applied writes are not covered by the table's undo history.
- A server-side "run pipeline" is the intended destination; `onApplyWrites`
  stays a callback so the same prop works against `HttpPagedDataAdapter`
  unchanged.

## Server-resident datasets

When rows live on the server, pass `source` (+ the workspace `filterTree`)
instead of `rows`:

```tsx
<RulesEngine
  source={{
    fetchSample: ({ rowStart, rowCount, filterTree }) => /* fetchPage-shaped */,
    totalRows,                       // unfiltered dataset size, when known
  }}
  filterTree={wb.query.filterTree}
  onApplyWrites={onApplyWrites}
/>
```

The component fetches a capped sample (first 200 matching rows) through the
host's page transport and re-fetches whenever `filterTree` changes. The
dry-run then evaluates **only the sample, and every label says so**: the
summary reads "M matched of first N sampled rows (F matching · T total)",
per-rule counts carry a "sampled" suffix, the apply confirm names the
sampled scope, and auto-apply is disabled — an apply loop that commits the
sample's writes while implying dataset coverage is exactly the dishonest
half-measure this prop exists to avoid.

Sampled apply is still real: fetched pages carry server `recordId`s, so
`RuleWrite`s commit through the same `PagedDataAdapter.commit` boundary —
useful for verifying a rule against real rows before a pipeline run.

### The all-matching-rows path is host work

A true "run pipeline on every matching row" endpoint is deliberately not
component work. The intended shape for a host that builds one:

```
POST /api/rules/run
{ datasetId, rules: PipelineRule[], filterTree? }  →
{ applied, rejected, revision }
```

The server evaluates conditions against its own data (the same operators
`filterTree`→SQL already covers), produces the write set, and commits it
under the dataset's revision semantics; the client's table picks it up
through ordinary revision/cache invalidation. The component's job ends at
proposing `RuleWrite[]` for the rows it can see — the sampled path exists
so the UI is honest today without pretending the endpoint exists.
