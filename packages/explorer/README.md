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

### Figure sizing (`spec.metrics`)

A host that authors a design screen at a different scale than the canonical
844×262 figure — the ELN's Analysis canvas sizes its text, markers and strokes
for a 0.758 display scale — passes a `metrics` group on the spec. Every field
is optional and defaults to the design's own value, so omitting `metrics`
leaves the figure unchanged.

```ts
const turbiditySpec: ChartSpec = {
  // …mapping, refLines, excludeField…
  metrics: {
    fontSize: 15, // tick labels, axis titles, legend        (default 11)
    labelFontSize: 14, // data labels: excluded/off-scale, bar, heat (default = fontSize)
    markerSize: 5, // marker radius / half-size              (default 4)
    lineWidth: 1.8, // series polylines                       (default 1.6)
    strokeWidth: 1.6, // marker outlines, box/violin strokes    (default 1.4)
    refStrokeWidth: 1, // dashed reference lines                (default 1)
  },
}
```

The resolved numbers land on the model as `figure.metrics` (including the
triangle marker's `triangleHalf`/`triangleHeight`/`triangleApexDy`, scaled from
`markerSize`), and both the SVG and the legend/scale text draw from them —
`Chart` sets `--sb-figure-font-size` on the figure frame for `figure.css`.
`resolveFigureMetrics` and `DEFAULT_FIGURE_METRICS` expose the resolution if
you build or inspect a model directly. The axis offset constants (`tickOffset`,
`titleOffset`, `tickGap`, `yTickBaseline`, `yTitleX`) are fixed layout values:
a text-size override scales the glyphs but does not move their baselines.

### Bar, box, heatmap, histogram and violin figures

`kind` selects five further primitives on the same `Chart`/`buildFigure`:

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
- **`histogram`** — a bin primitive: `x` (falling back to `y`) is the numeric
  measure and is split into equal-width bins over the observed range.
  `histogramBinWidth` sets an explicit width (wins over `histogramBins`);
  otherwise `histogramBins` fixes the count and a non-positive value falls back
  to Sturges' rule. Bars land on a numeric `x` axis and count per bin, or plot
  a probability density when `histogramDensity` is set. A series field
  (`group`/`color`) shares the bin edges and groups (`barLayout: 'grouped'`) or
  stacks (`'stacked'`) the bars.
- **`violin`** — a density primitive: the Gaussian KDE of `y` per category
  (`x`, or the series field when no `x` is given) and series, drawn as a closed
  density profile on a band axis with the design's box overlay (five-number
  summary + Tukey whiskers) on the same band. `violinBandwidth` sets the KDE
  bandwidth; Silverman's rule-of-thumb is used otherwise.

The marks land on the model (`bars` + `bins`, `boxes`, `heat`, `violins`)
together with a `scaleLegend` for a heatmap, so a host can assert or restyle
them. `bandScale`, `boxSummary`, `heatmapColour`, `HEATMAP_SCALE_STEPS`,
`binEdges`, `kde` and `kdeBandwidth` expose the band geometry, the colour scale
and the distribution maths directly. Shared-x stacks are numeric-only, so
`buildFigureGroup` returns `null` when an entry is one of these categorical or
distribution kinds.

The v3 design screens (`Analysis`, `ExpResults`) define line and point charts;
bar, box, heatmap, histogram and violin are the primitives the ELN's chart
specs additionally need, rendered to the same v3 chart rules.

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
