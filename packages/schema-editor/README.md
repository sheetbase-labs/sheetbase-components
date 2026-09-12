# sheetbase-schemaeditor

Zoomable schema graph: model list (left), canvas (centre), inspector (right). Field types and references use `sheetbase-shared`. Emits `create table` DDL (`graphToDdl`), imports it back (`ddlToGraph`), and diffs two graphs into `alter table` migrations (`diffGraphs` / `graphDiffToDdl`).

```bash
bun install
bun run dev:schema   # http://localhost:5201/
```

```tsx
import { SchemaEditor } from "sheetbase-schemaeditor"
import "sheetbase-schemaeditor/styles.css"
```
