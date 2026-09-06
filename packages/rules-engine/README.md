# sheetbase-rulesengine

Natural-language pipeline rules with a dry-run tester. Conditions evaluate through `sheetbase-shared` (`toFilterClause` / `testCondition` / `filterRows`).

```bash
bun install
bun run dev:rules   # http://localhost:5202/
```

```tsx
import { RulesEngine, parseNaturalLanguageRule, matchRules } from "sheetbase-rulesengine"
import "sheetbase-rulesengine/styles.css"
```
