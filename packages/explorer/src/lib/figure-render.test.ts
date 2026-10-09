/**
 * COMP-07 distributions, renderer side: `FigureSvg` must actually draw the
 * histogram bars and the violin density profile + box overlay from the model
 * (the standalone `Chart`/`FigureSvg` path, not just the geometry).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FigureSvg } from '../Chart'
import { buildFigure } from './figure'
import type { ChartSpec, Dataset } from './types'

function spec(partial: Partial<ChartSpec>): ChartSpec {
  return {
    kind: 'histogram', aggregate: 'none', showGrid: true, showPoints: true,
    pointSize: 4, pointOpacity: 1, lineWidth: 1.6, lineOpacity: 1,
    fillOpacity: 1, barGap: 2, barRadius: 3, barLayout: 'grouped',
    histogramBins: 2, palette: [],
    ...partial,
  }
}

const histogramDataset: Dataset = {
  name: 'Histogram fixture',
  source: 'fixture',
  rows: [
    { Score: 2 }, { Score: 3 }, { Score: 7 }, { Score: 12 }, { Score: 18 }, { Score: 19 },
  ],
  columns: [{ key: 'Score', kind: 'number', nullable: false, uniqueCount: 6 }],
}

const violinDataset: Dataset = {
  name: 'Violin fixture',
  source: 'fixture',
  rows: [
    { Train: 'A', Yield: 10 }, { Train: 'A', Yield: 12 }, { Train: 'A', Yield: 14 }, { Train: 'A', Yield: 16 },
    { Train: 'B', Yield: 20 }, { Train: 'B', Yield: 22 }, { Train: 'B', Yield: 24 }, { Train: 'B', Yield: 26 },
  ],
  columns: [
    { key: 'Train', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'Yield', kind: 'number', nullable: false, uniqueCount: 8 },
  ],
}

describe('distribution figures render', () => {
  it('draws histogram bars from the bin primitive', () => {
    const figure = buildFigure(histogramDataset, spec({ kind: 'histogram', x: 'Score' }))
    if (!figure) throw new Error('the histogram figure should build')
    const markup = renderToStaticMarkup(FigureSvg({ figure }))
    expect(markup).toContain('<rect')
    expect(markup).toContain('aria-label="Histogram of Score, 6 rows"')
    expect(markup.match(/<rect/g)?.length).toBe(2)
  })

  it('draws the violin profile and its box overlay', () => {
    const figure = buildFigure(violinDataset, spec({ kind: 'violin', x: 'Train', y: 'Yield' }))
    if (!figure) throw new Error('the violin figure should build')
    const markup = renderToStaticMarkup(FigureSvg({ figure }))
    expect(markup.match(/<polygon/g)?.length).toBe(2)
    // Two violins, each with an IQR box rect.
    expect(markup.match(/<rect/g)?.length).toBe(2)
    expect(markup).toContain('aria-label="Violin plot of Yield against Train, 8 rows"')
  })

  it('draws the resolved metrics for text, markers and series strokes', () => {
    const metrics = { fontSize: 15, labelFontSize: 14, markerSize: 5, lineWidth: 1.8, strokeWidth: 1.6 }
    const scaled = buildFigure(violinDataset, spec({ kind: 'line', x: 'Yield', y: 'Yield', metrics }))
    if (!scaled) throw new Error('the line figure should build')
    const scaledMarkup = renderToStaticMarkup(FigureSvg({ figure: scaled }))
    expect(scaledMarkup).toContain('stroke-width="1.8"')
    expect(scaledMarkup).toContain('r="5"')
    expect(scaledMarkup).toContain('font-size:15px')

    const plain = buildFigure(violinDataset, spec({ kind: 'line', x: 'Yield', y: 'Yield' }))
    if (!plain) throw new Error('the line figure should build')
    const plainMarkup = renderToStaticMarkup(FigureSvg({ figure: plain }))
    expect(plainMarkup).toContain('stroke-width="1.6"')
    expect(plainMarkup).toContain('r="4"')
    expect(plainMarkup).toContain('font-size:11px')
  })
})
