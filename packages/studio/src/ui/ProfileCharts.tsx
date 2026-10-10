import type { FieldProfile, SheetbaseField } from '@sheetbase-labs/sheetbase-shared'
import { formatCount, formatStat, percent } from './data'

/** One bar in a profile chart; `active` marks a bar the view already filters on. */
export interface ProfileBar {
  key: string
  label: string
  count: number
  active?: boolean
}

export function histogramBars(field: SheetbaseField, profile: FieldProfile, activeKeys: ReadonlySet<string>): ProfileBar[] {
  const histogram = profile.histogram
  if (!histogram || histogram.edges.length < 2) return []
  const date = field.dataType === 'date' || field.dataType === 'datetime'
  const label = (value: number) => (date ? new Date(value).toISOString().slice(0, field.dataType === 'date' ? 10 : 16).replace('T', ' ') : formatStat(value))
  return histogram.counts.map((count, index) => {
    const low = histogram.edges[index] as number
    const high = histogram.edges[index + 1] as number
    const key = `${low}|${high}`
    return { key, label: `${label(low)} – ${label(high)}`, count, active: activeKeys.has(key) }
  })
}

export function topBars(profile: FieldProfile, activeKeys: ReadonlySet<string>): ProfileBar[] {
  return (profile.top ?? []).map((entry) => ({ key: entry.value, label: entry.value, count: entry.count, active: activeKeys.has(entry.value) }))
}

/** Row-level sparkline: bars only, no labels, never interactive. */
export function Sparkline({ bars, width = 64, height = 18, label }: { bars: readonly ProfileBar[]; width?: number; height?: number; label: string }) {
  if (!bars.length) return <span className="sbs-spark sbs-spark--empty" aria-hidden="true" />
  const max = Math.max(1, ...bars.map((bar) => bar.count))
  const gap = bars.length > 24 ? 0.5 : 1
  const barWidth = (width - gap * (bars.length - 1)) / bars.length
  return (
    <svg className="sbs-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {bars.map((bar, index) => {
        const h = bar.count === 0 ? 0 : Math.max(1.5, (bar.count / max) * height)
        return <rect key={bar.key} x={index * (barWidth + gap)} y={height - h} width={Math.max(0.5, barWidth)} height={h} rx={0.75} className={bar.active ? 'is-active' : undefined} />
      })}
    </svg>
  )
}

/** Clickable distribution for the profile card: vertical bins for measures. */
export function BinChart({ bars, total, onPick }: { bars: readonly ProfileBar[]; total: number; onPick?: (bar: ProfileBar) => void }) {
  const max = Math.max(1, ...bars.map((bar) => bar.count))
  return (
    <fieldset className="sbs-bins-group" aria-label="Distribution — choose a range to filter on it">
      {/* Layout lives on an inner box: a fieldset's anonymous content box won't resolve the bars' % heights. */}
      <div className="sbs-bins">
        {bars.map((bar) => (
          <button
            key={bar.key}
            type="button"
            className={`sbs-bin${bar.active ? ' is-active' : ''}`}
            style={{ ['--h' as string]: `${bar.count === 0 ? 0 : Math.max(3, (bar.count / max) * 100)}%` }}
            title={`${bar.label}: ${formatCount(bar.count)} rows (${percent(bar.count, total)})${onPick ? bar.active ? ' — click to remove the filter' : ' — click to filter' : ''}`}
            aria-pressed={bar.active ?? false}
            aria-label={`${bar.label}: ${formatCount(bar.count)} rows`}
            onClick={onPick ? () => onPick(bar) : undefined}
            disabled={!onPick || bar.count === 0}
          >
            <span />
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Clickable top values for categories: label, bar, count. */
export function ValueBars({ bars, total, distinct, onPick }: { bars: readonly ProfileBar[]; total: number; distinct: number | null; onPick?: (bar: ProfileBar) => void }) {
  const max = Math.max(1, ...bars.map((bar) => bar.count))
  const shown = bars.reduce((sum, bar) => sum + bar.count, 0)
  return (
    <fieldset className="sbs-values" aria-label="Most frequent values — choose one to filter on it">
      {bars.map((bar) => (
        <button
          key={bar.key}
          type="button"
          className={`sbs-value${bar.active ? ' is-active' : ''}`}
          aria-pressed={bar.active ?? false}
          title={onPick ? bar.active ? 'Remove this filter' : `Keep rows where the value is "${bar.label}"` : undefined}
          onClick={onPick ? () => onPick(bar) : undefined}
          disabled={!onPick}
        >
          <span className="sbs-value-label">{bar.label}</span>
          <span className="sbs-value-bar" style={{ ['--w' as string]: `${(bar.count / max) * 100}%` }} aria-hidden="true" />
          <span className="sbs-value-count">{formatCount(bar.count)}</span>
        </button>
      ))}
      {distinct !== null && distinct > bars.length && (
        <div className="sbs-values-more">+{formatCount(distinct - bars.length)} more values · {percent(total - shown, total)} of rows</div>
      )}
    </fieldset>
  )
}
