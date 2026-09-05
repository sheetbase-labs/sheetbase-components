# sheetbase-advanced-search

Nested AND / OR / NOT search with grouping, sorting, limit, and a live table preview. Filter evaluation lives in `sheetbase-shared`.

```bash
bun install
bun run dev:search   # http://localhost:5203/
```

```tsx
import { AdvancedSearch, applySearch } from "sheetbase-advanced-search"
import "sheetbase-advanced-search/styles.css"
```
