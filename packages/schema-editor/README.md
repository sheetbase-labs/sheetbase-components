# @sheetbase-labs/sheetbase-schemaeditor

Zoomable schema graph: model list (left), canvas (centre), inspector (right). Field types and references use `@sheetbase-labs/sheetbase-shared`. Emits `create table` DDL (`graphToDdl`), imports it back (`ddlToGraph`), and diffs two graphs into `alter table` migrations (`diffGraphs` / `graphDiffToDdl`).

The topbar "Import SQL" dialog pastes or drops SQL — `create table` DDL, query SQL (Trino/Postgres/DuckDB), or a dbt project — and `analyzeSql` draws it as an ERD: source tables, joins, CTEs/subqueries and result columns. dbt `{{ ref(...) }}` / `{{ source(...) }}` expand, `-- model_name.sql` headers name each node, and files can arrive in any order.

```bash
bun install
bun run dev:schema          # http://localhost:5201/ — Vite dev server, HMR
```

Two dev modes:

- `bun run dev` (a.k.a. `dev:schema`) — the Vite module server with HMR. `@sheetbase-labs/sheetbase-shared` is pre-bundled via `optimizeDeps` so the page fetches one library module instead of ~20 source modules; restart after editing shared source, or run `bun run build:lib`.
- `bun run dev:bundled` — `vite build --watch` into `dist-dev/` served by `vite preview`. The same page loads in ~3 requests instead of ~24, which matters on high-latency links (the orb portal runs this mode); edits rebuild in under a second, reload to pick them up.

```tsx
import { SchemaEditor } from "@sheetbase-labs/sheetbase-schemaeditor";
import "@sheetbase-labs/sheetbase-schemaeditor/styles.css";
```
