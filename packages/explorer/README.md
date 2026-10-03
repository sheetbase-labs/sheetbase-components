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

### Bar, box and heatmap figures

`kind` selects three further primitives on the same `Chart`/`buildFigure`:

- **`bar`** — a categorical `x` axis. `barLayout: 'grouped'` sets sibling
  series side by side within the category band, `'stacked'` stacks them on an
  accumulated baseline and `'normalized'` fills each category to 1. Bars rise
  from a zero baseline; `barGap`, `labels` and `categoryOrder` behave as they
  do in the explorer.
- **`box`** — the five-number summary of `y` per category (interpolated
  quartiles, Tukey whiskers), with the points beyond the whiskers kept as
  outliers. `showPoints` opts the outliers in (the ExpResults "show replicate
  spread" rule).
- **`heatmap`** — the `x` and `y` fields are the grid's categories; each cell
  is `size` aggregated per cell by `aggregate` (default sum), or the row count
  when no `size` is given. Cells use a discrete five-step sequential scale
  mixed from the theme's series hue over the surface — never a literal, and
  stepped rather than a gradient — legended with the data range's ends.

The marks land on the model (`bars`, `boxes`, `heat`) together with a
`scaleLegend` for a heatmap, so a host can assert or restyle them.
`bandScale`, `boxSummary`, `heatmapColour` and `HEATMAP_SCALE_STEPS` expose the
band geometry and the scale directly. Shared-x stacks are numeric-only, so
`buildFigureGroup` returns `null` when an entry is one of these categorical
kinds.

The v3 design screens (`Analysis`, `ExpResults`) define line and point charts;
bar, box and heatmap are the primitives the ELN's chart specs additionally
need, rendered to the same v3 chart rules. The design defines no violin or
summary/interval primitive, so none is provided.

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
