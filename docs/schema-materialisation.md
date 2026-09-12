# Schema materialisation

`SchemaGraph` is design-time state — `graphToDdl` / `graphToProvision`
(`sheetbase-schemaeditor`) turn it into something a host can provision. This is
the write-side counterpart to `onHeaderFieldsChange`: the editor proposes, the
host executes. There is no live apply path — running DDL or POSTing the payload
is host work.

## DDL (`graphToDdl`)

Postgres-flavoured `create table` statements, in graph order:

- `text` → `text`, `number` → `numeric` (exact arithmetic — safer than
  `double precision` for a data tool), `boolean` → `boolean`, `date` → `date`,
  `datetime` → `timestamptz`
- `primaryKey: true` → `primary key`; `nullable: false` → `not null`
- `relationship` → column typed after the referenced PK's SQL type (falls back
  to `text` when unresolvable) plus `references "model"("pk")`
- Identifiers are always `"quoted"` with inner quotes doubled

Emission throws `SchemaValidationError` when `validateGraph` reports errors —
a host never receives DDL for a schema the editor itself flags. The editor's
topbar "Export SQL" / "Export payload" buttons disable while errors exist and
list them in the tooltip.

## Provisioning payload (`graphToProvision`)

For hosts that call an API instead of running SQL: the graph cleaned to
`{ models: [{ name, label?, fields: [{ key, label?, type, nullable?,
primaryKey?, references? }] }] }`. Same validation gate.

## Migrations (`diffGraphs` / `graphDiffToDdl`)

The intended flow: `ddlToGraph(current DDL)` gives a `previous` graph
representing what exists, the host edits or re-exports, and
`graphDiffToDdl(previous, next)` emits the migration — `create table` for
new models, one `alter table` per altered model (`add column`,
`alter column … type`, `set`/`drop not null`, `add`/`drop constraint` for
key/reference changes under Postgres's default `<table>_pkey` /
`<table>_<col>_fkey` names), `drop table` last.

- Matching is by model `name` / field `key` — a rename is a drop+add.
- `diffGraphs` returns the structured `SchemaDiff` (create / drop / alter)
  plus `destructive`: the human-readable list of drops and type changes a
  host UI should gate on. `next` must pass `validateGraph` (throws);
  `previous` is trusted — its errors land in `diff.warnings`.
- Default emission is additive-safe: `drop column`/`drop table` emit only
  with `graphDiffToDdl(previous, next, { drops: true })`. `destructive`
  reports them either way.
- This is schema diffing, not data migration — no `using` clauses, no
  backfills; hosts needing data-preserving type changes write their own.

## Limitations

- Composite primary keys are not modelled; an FK references the target's single
  `primaryKey` field (or `references.field` when named explicitly).
- The type map covers `FieldDataType` only — no arrays, enums, or
  precision/scale on `numeric` yet.

## Import (`ddlToGraph`)

The read-side counterpart: paste `create table` DDL and get a `SchemaGraph`
back. Understands the emitted grammar plus common Postgres spellings —
`if not exists`, schema-qualified names (`public.samples` → `samples`),
type aliases (`varchar`, `int`, `serial`, `double precision`,
`timestamp with time zone`), column and table-level `primary key` /
`foreign key ... references` constraints. A column with `references`
imports as `type: "relationship"`; a `references ("pk")` that restates the
target's primary key is normalised to the implicit `{ model }` form.
Unknown column types become `text`. Throws `SchemaParseError` when no
statement yields a model; skipped statements are listed in `error.errors`.

The editor's topbar "Import SQL" opens a paste dialog that replaces the
graph (`cmd/ctrl+Enter` to import, `Esc` to close). Imported graphs are
auto-laid-out and flow through the normal commit path — in the workbench
the table, search, explorer and rules panes all re-render from the new
fields via `onHeaderFieldsChange`.

## `datetime` parity

`SheetbaseField` has six data types; the table's `CellDataType` now includes
`datetime` (validated as `YYYY-MM-DD HH:MM[:SS]`, edited via
`datetime-local` inputs) — the workbench's `datetime`→`date` remap is gone.
