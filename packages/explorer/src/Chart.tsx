/**
 * COMP-03.1/03.2/03.3: the standalone v3 `Chart`.
 *
 * Spec in, SVG out, with no dependency on the explorer `App`: a notebook
 * figure, a report page or a signed record can render one chart, or a stack of
 * charts that share an x axis, from the same `ChartSpec` the explorer uses.
 * Geometry comes from `lib/figure.ts`; this file only draws it.
 *
 * Everything is painted from theme variables as inline styles, so a host can
 * retheme the figure (default preset or `themes/v3.css`) without touching it.
 */
import { useMemo } from 'react'
import {
  FIGURE_LAYOUT, FIGURE_TOKENS, buildFigure, buildFigureGroup, formatValue, type FigureMarkerStyle,
  type FigureModel, type FigurePadding, type FigureScaleLegend,
} from './lib/figure'
import type { ChartSpec, Dataset } from './lib/types'

const TEXT = { fontSize: FIGURE_LAYOUT.fontSize } as const
const MUTED_TEXT = { ...TEXT, fill: FIGURE_TOKENS.muted } as const
const BOLD_TEXT = { ...TEXT, fill: FIGURE_TOKENS.text } as const
const DANGER_TEXT = { ...TEXT, fill: FIGURE_TOKENS.danger } as const

/** A series marker at a plot position; `hollow` marks an excluded point. */
function PlotMarker({ style, px, py, hollow }: { style: FigureMarkerStyle; px: number; py: number; hollow?: boolean }) {
  const paint = hollow
    ? { fill: FIGURE_TOKENS.surface, stroke: style.colour, strokeWidth: FIGURE_LAYOUT.strokeWidth }
    : { fill: style.colour }
  const size = FIGURE_LAYOUT.markerSize
  if (style.marker === 'square') {
    return <rect x={px - size} y={py - size} width={size * 2} height={size * 2} style={paint} />
  }
  if (style.marker === 'triangle') {
    const half = FIGURE_LAYOUT.triangleHalf
    const height = FIGURE_LAYOUT.triangleHeight
    return <path d={`M${px} ${py + FIGURE_LAYOUT.triangleApexDy}l${half} ${height}h-${half * 2}z`} style={paint} />
  }
  return <circle cx={px} cy={py} r={size} style={paint} />
}

/** The design's 10×10 legend glyph. */
function LegendGlyph({ style }: { style: FigureMarkerStyle }) {
  const paint = { fill: style.colour }
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
      {style.marker === 'circle' ? <circle cx={5} cy={5} r={3.5} style={paint} />
        : style.marker === 'square' ? <rect x={1.5} y={1.5} width={7} height={7} style={paint} />
          : <path d="M5 1l4 7.5H1z" style={paint} />}
    </svg>
  )
}

function FigureLegend({ items }: { items: FigureModel['legend'] }) {
  if (!items.length) return null
  return (
    <div className="sb-figure-legend">
      {items.map((item) => (
        <span key={item.label} className="sb-figure-legend__item">
          <LegendGlyph style={item.style} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

/** Bar marks (kind `bar`): one rectangle per bar, above its own value label. */
function BarMarks({ bars }: { bars: NonNullable<FigureModel['bars']> }) {
  return (
    <g>
      {bars.map((bar) => (
        <rect
          key={`bar-${bar.index}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          style={{ fill: bar.colour }}
        />
      ))}
      {bars.map((bar) => bar.label === undefined || bar.labelX === undefined || bar.labelY === undefined ? null : (
        <text key={`bar-label-${bar.index}`} x={bar.labelX} y={bar.labelY} textAnchor="middle" style={MUTED_TEXT}>
          {bar.label}
        </text>
      ))}
    </g>
  )
}

/** Box marks (kind `box`): box, median, whiskers, caps and outlier points. */
function BoxMarks({ boxes }: { boxes: NonNullable<FigureModel['boxes']> }) {
  const stroke = { strokeWidth: FIGURE_LAYOUT.strokeWidth }
  return (
    <g>
      {boxes.map((box) => {
        const boxKey = `${box.category}|${box.seriesId}`
        const cap = box.width / 2
        return (
          <g key={boxKey}>
            <line x1={box.px} y1={box.yQ1} x2={box.px} y2={box.yWhiskerLow} style={{ ...stroke, stroke: box.colour }} />
            <line x1={box.px} y1={box.yQ3} x2={box.px} y2={box.yWhiskerHigh} style={{ ...stroke, stroke: box.colour }} />
            <line x1={box.px - cap / 2} y1={box.yWhiskerLow} x2={box.px + cap / 2} y2={box.yWhiskerLow} style={{ ...stroke, stroke: box.colour }} />
            <line x1={box.px - cap / 2} y1={box.yWhiskerHigh} x2={box.px + cap / 2} y2={box.yWhiskerHigh} style={{ ...stroke, stroke: box.colour }} />
            <rect
              x={box.x}
              y={Math.min(box.yQ1, box.yQ3)}
              width={box.width}
              height={Math.abs(box.yQ3 - box.yQ1)}
              style={{ fill: box.colour, fillOpacity: 0.16, stroke: box.colour, strokeWidth: FIGURE_LAYOUT.strokeWidth }}
            />
            <line
              x1={box.x}
              y1={box.yMedian}
              x2={box.x + box.width}
              y2={box.yMedian}
              style={{ stroke: box.colour, strokeWidth: FIGURE_LAYOUT.strokeWidth * 1.5 }}
            />
            {box.showOutliers ? box.outliers.map((outlier) => (
              <circle
                key={`${boxKey}|${outlier.index}`}
                cx={outlier.px}
                cy={outlier.py}
                r={FIGURE_LAYOUT.markerSize - 1}
                style={{ fill: box.colour }}
              />
            )) : null}
          </g>
        )
      })}
    </g>
  )
}

/** Heatmap marks (kind `heatmap`): one cell per aggregated grid position. */
function HeatMarks({ heat }: { heat: NonNullable<FigureModel['heat']> }) {
  return (
    <g>
      {heat.map((cell) => (
        <rect
          key={`${cell.x}|${cell.y}`}
          x={cell.rect.x}
          y={cell.rect.y}
          width={cell.rect.width}
          height={cell.rect.height}
          style={{ fill: cell.colour }}
        />
      ))}
      {heat.map((cell) => cell.label === undefined || cell.labelX === undefined || cell.labelY === undefined ? null : (
        <text key={`${cell.x}|${cell.y}|label`} x={cell.labelX} y={cell.labelY} textAnchor="middle" style={MUTED_TEXT}>
          {cell.label}
        </text>
      ))}
    </g>
  )
}

/**
 * Violin marks (kind `violin`): the closed density profile, then the design's
 * box overlay (whisker line, IQR box, median) on the same band.
 */
function ViolinMarks({ violins }: { violins: NonNullable<FigureModel['violins']> }) {
  return (
    <g>
      {violins.map((violin) => {
        const key = `${violin.category}|${violin.seriesId}`
        const overlayWidth = Math.min(violin.width, 8)
        const overlayX = violin.px - overlayWidth / 2
        const stroke = { strokeWidth: FIGURE_LAYOUT.strokeWidth }
        return (
          <g key={key}>
            <polygon
              points={violin.outline.map((point) => `${point.px},${point.py}`).join(' ')}
              style={{
                fill: violin.colour,
                fillOpacity: 0.16,
                stroke: violin.colour,
                strokeWidth: FIGURE_LAYOUT.strokeWidth,
              }}
            />
            <line x1={violin.px} y1={violin.box.yWhiskerLow} x2={violin.px} y2={violin.box.yWhiskerHigh} style={{ ...stroke, stroke: violin.colour }} />
            <rect
              x={overlayX}
              y={Math.min(violin.box.yQ1, violin.box.yQ3)}
              width={overlayWidth}
              height={Math.abs(violin.box.yQ3 - violin.box.yQ1)}
              style={{ fill: FIGURE_TOKENS.surface, stroke: violin.colour, strokeWidth: FIGURE_LAYOUT.strokeWidth }}
            />
            <line
              x1={overlayX}
              y1={violin.box.yMedian}
              x2={overlayX + overlayWidth}
              y2={violin.box.yMedian}
              style={{ stroke: violin.colour, strokeWidth: FIGURE_LAYOUT.strokeWidth * 1.5 }}
            />
          </g>
        )
      })}
    </g>
  )
}

/** The heatmap's discrete colour scale: its steps, with the range's ends. */
function ScaleLegend({ legend }: { legend: FigureScaleLegend }) {
  return (
    <div className="sb-figure-scale">
      <span className="sb-figure-scale__label">{legend.label}</span>
      <span className="sb-figure-scale__swatches">
        {legend.steps.map((step) => (
          <span key={step.label} className="sb-figure-scale__swatch" style={{ background: step.colour }} title={step.label} />
        ))}
      </span>
      <span className="sb-figure-scale__end">{formatValue(legend.min)}</span>
      <span className="sb-figure-scale__end">{formatValue(legend.max)}</span>
    </div>
  )
}

/** The figure's SVG: gridlines, quiet axes, reference lines, series, labels. */
export function FigureSvg({ figure, ariaLabel, className }: { figure: FigureModel; ariaLabel?: string; className?: string }) {
  const { plot } = figure
  const xAxis = (
    <>
      <line x1={plot.x} y1={plot.y + plot.height} x2={plot.x + plot.width} y2={plot.y + plot.height} style={{ stroke: FIGURE_TOKENS.axis }} />
      <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.height} style={{ stroke: FIGURE_TOKENS.axis }} />
    </>
  )
  return (
    <svg
      className={className ? `sb-figure ${className}` : 'sb-figure'}
      width={figure.width}
      height={figure.height}
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      role="img"
      aria-label={ariaLabel ?? figure.ariaLabel}
    >
      <g style={{ stroke: FIGURE_TOKENS.grid }}>
        {figure.gridlines.map((py) => (
          <line key={`grid-${py}`} x1={plot.x} y1={py} x2={plot.x + plot.width} y2={py} />
        ))}
      </g>
      {xAxis}
      {figure.refLines.map((line) => (
        <line
          key={line.id}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          strokeDasharray={FIGURE_LAYOUT.refDash}
          style={{ stroke: FIGURE_TOKENS.text }}
        />
      ))}
      {figure.refLines.map((line) => (
        <text
          key={`${line.id}-label`}
          x={line.labelX}
          y={line.labelY}
          textAnchor={line.axis === 'y' ? 'end' : 'start'}
          style={BOLD_TEXT}
        >
          {line.text}
        </text>
      ))}
      <g textAnchor="end" style={MUTED_TEXT}>
        {figure.y.ticks.map((tick) => (
          <text key={`y-${tick.value}`} x={tick.px} y={tick.py + FIGURE_LAYOUT.yTickBaseline}>
            {tick.label}
          </text>
        ))}
      </g>
      <g textAnchor="middle" style={MUTED_TEXT}>
        {figure.x.ticks.map((tick) => (
          <text key={`x-${tick.value}`} x={tick.px} y={tick.py}>
            {tick.label}
          </text>
        ))}
      </g>
      {figure.xTitle ? (
        <text
          x={plot.x + plot.width / 2}
          y={plot.y + plot.height + FIGURE_LAYOUT.titleOffset}
          textAnchor="middle"
          style={BOLD_TEXT}
        >
          {figure.xTitle}
        </text>
      ) : null}
      {figure.yTitle ? (
        <text
          x={FIGURE_LAYOUT.yTitleX}
          y={plot.y + plot.height / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${FIGURE_LAYOUT.yTitleX} ${plot.y + plot.height / 2})`}
          style={BOLD_TEXT}
        >
          {figure.yTitle}
        </text>
      ) : null}
      {figure.bars?.length ? <BarMarks bars={figure.bars} /> : null}
      {figure.boxes?.length ? <BoxMarks boxes={figure.boxes} /> : null}
      {figure.heat?.length ? <HeatMarks heat={figure.heat} /> : null}
      {figure.violins?.length ? <ViolinMarks violins={figure.violins} /> : null}
      {figure.series.map((entry) => (
        <g key={entry.id || 'series'}>
          {entry.line.length > 1 ? (
            <polyline
              points={entry.line.map((point) => `${point.px},${point.py}`).join(' ')}
              fill="none"
              strokeWidth={FIGURE_LAYOUT.lineWidth}
              style={{ stroke: entry.style.colour }}
            />
          ) : null}
          {entry.points.map((point) => point.py === undefined || (!entry.markers && !point.excluded) ? null : (
            <PlotMarker key={point.rowId ?? point.index} style={entry.style} px={point.px} py={point.py} hollow={point.excluded} />
          ))}
          {entry.points.map((point) => point.label === undefined || point.labelX === undefined || point.labelY === undefined ? null : (
            <text key={`label-${point.rowId ?? point.index}`} x={point.labelX} y={point.labelY} style={DANGER_TEXT}>
              {point.label}
            </text>
          ))}
        </g>
      ))}
    </svg>
  )
}

export interface ChartProps {
  dataset: Dataset
  spec: ChartSpec
  /** Figure units (SVG viewBox). Defaults to the design's 844×262. */
  width?: number
  height?: number
  padding?: Partial<FigurePadding>
  /** Axis titles: notebook figures show both; the Analysis stack hides them. */
  showXAxisTitle?: boolean
  showYAxisTitle?: boolean
  /** Series legend above the figure (the design's inline legend) or none. */
  legend?: 'above' | 'none'
  /** Overrides the figure's generated description. */
  ariaLabel?: string
  className?: string
}

/** One v3 figure. Renders nothing when the spec has no numeric x/y mapping. */
export function Chart({ dataset, spec, width, height, padding, showXAxisTitle, showYAxisTitle, legend = 'above', ariaLabel, className }: ChartProps) {
  const figure = useMemo(
    () => buildFigure(dataset, spec, { width, height, padding, showXAxisTitle, showYAxisTitle }),
    [dataset, spec, width, height, padding, showXAxisTitle, showYAxisTitle],
  )
  if (!figure) return null
  return (
    <div className="sb-figure-frame">
      {legend === 'above' ? <FigureLegend items={figure.legend} /> : null}
      {legend === 'above' && figure.scaleLegend ? <ScaleLegend legend={figure.scaleLegend} /> : null}
      <FigureSvg figure={figure} ariaLabel={ariaLabel} className={className} />
    </div>
  )
}

export interface ChartGroupEntry {
  spec: ChartSpec
  height?: number
}

export interface ChartGroupProps {
  dataset: Dataset
  /** Figures stacked top to bottom (the Analysis screen shows two). */
  charts: ChartGroupEntry[]
  /** Shared figure width; every chart gets the same x pixel positions. */
  width?: number
  padding?: Partial<FigurePadding>
  /** Where the shared x-axis title is drawn. Default: the last chart only. */
  xTitle?: 'last' | 'all' | 'none'
  /** Draw each chart's y-axis title. Default false (headings carry it). */
  yTitle?: boolean
  legend?: 'above' | 'none'
  /** Vertical gap between figures, in px. */
  gap?: number
  className?: string
}

/**
 * Charts that share one x axis: the same domain and ticks, so a load of 100
 * sits at the same x in every figure, and only the bottom chart labels the
 * shared axis.
 */
export function ChartGroup({ dataset, charts, width, padding, xTitle = 'last', yTitle = false, legend = 'above', gap = 18, className }: ChartGroupProps) {
  const group = useMemo(
    () => buildFigureGroup(dataset, charts.map((chart, index) => ({
      ...chart,
      showXAxisTitle: xTitle === 'all' || (xTitle === 'last' && index === charts.length - 1),
      showYAxisTitle: yTitle,
    })), { width, padding }),
    [dataset, charts, width, padding, xTitle, yTitle],
  )
  if (!group) return null
  return (
    <div className={className ? `sb-figure-group ${className}` : 'sb-figure-group'} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {group.figures.map((figure, index) => (
        // A chart in a shared-axis stack is identified by its measure's title.
        <div className="sb-figure-frame" key={figure.y.title}>
          {/* The design legends a shared-axis stack once, above its first chart. */}
          {legend === 'above' && index === 0 ? <FigureLegend items={figure.legend} /> : null}
          {legend === 'above' && index === 0 && figure.scaleLegend ? <ScaleLegend legend={figure.scaleLegend} /> : null}
          <FigureSvg figure={figure} />
        </div>
      ))}
    </div>
  )
}
