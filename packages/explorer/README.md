# Sheetbase Explorer

Chart-first exploration workspace for Sheetbase. Import data, query it with SQL, and build analytical charts with TanStack Charts. Filter operators come from `@sheetbase-labs/sheetbase-shared`.

```bash
bun run dev
```

Vite serves the demo on port 5199. Styles, theme and element selectors are scoped under `.sheetbase-explorer`.

## Standalone v3 figures (COMP-03)

`Chart` renders one figure from a `ChartSpec` and `Dataset` without the explorer
`App` — a notebook figure, a report page or a signed record can mount it
directly. `ChartGroup` stacks several figures that share one x axis (the
Analysis screen's step-yield and turbidity charts), so the same load sits at
the same pixel in every chart.

```tsx
import { Chart, ChartGroup, FieldRolePanel, buildFigure, specWithRole } from '@sheetbase-labs/sheetbase-explorer'

<Chart dataset={dataset} spec={spec} />                       {/* 844×262 design figure */}
<ChartGroup dataset={dataset} charts={[{ spec: yieldSpec }, { spec: turbiditySpec, height: 196 }]} />
```

The v3 rules come from the design system: series colours are `series-a/b/c`
with circle, square and triangle markers by series index; points whose
`excludeField` flags them are drawn hollow (and, when off-scale, pinned at the
plot edge with a value label); reference lines are dashed and labelled with
their value and unit; axes are quiet with fine gridlines; axis titles carry
units (`spec.xUnit`/`spec.yUnit`). Colours are theme variables only, so load
`@sheetbase-labs/sheetbase-shared/themes/v3.css` (or map the variables onto your own) as usual.

`buildFigure` / `buildFigureGroup` return the plain geometry model behind the
components if you need the numbers, and `describeFigure` produces the
screen-reader description.

## Field-role panel (COMP-03.4)

`FieldRolePanel` is the Analysis screen's field list and axis wells: drag (or
pick) a field onto x, y, y2 or series, and add calculated `ƒx` fields through
the host. `rolesFromSpec` and `specWithRole` keep the panel and the
`ChartSpec` in step.

```tsx
<FieldRolePanel
  fields={chartFieldsFromDataset(dataset, { units: { Load: 'L/m²' } })}
  roles={rolesFromSpec(spec)}
  onAssign={(role, key) => setSpec((current) => specWithRole(current, role, key))}
  onAddCalculatedField={({ label, expression }) => addField({ label, expression })}
/>
```
