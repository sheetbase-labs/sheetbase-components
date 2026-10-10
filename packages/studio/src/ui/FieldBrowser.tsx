import { useMemo, useState } from 'react'
import type { ConditionNode, FieldProfile, FilterOperator, GroupNode, SheetbaseField } from '@sheetbase-labs/sheetbase-shared'
import { CATEGORY_LIMIT, isCategorical, type FieldRole } from '../lib/presets'
import { formatCount, formatStat, percent } from './data'
import { BinChart, histogramBars, Sparkline, topBars, ValueBars, type ProfileBar } from './ProfileCharts'

export type ProfileScope = 'filtered' | 'all'

export interface FieldBrowserProps {
  tableLabel: string
  fields: readonly SheetbaseField[]
  profiles: ReadonlyMap<string, FieldProfile>
  /** Rows the profiles were computed over. */
  profiledRows: number | null
  /** Rows in the whole table. */
  tableRows: number | null
  /** Rows matching the current view's filter. */
  matchingRows: number | null
  loading: boolean
  error: string | null
  onRetry(): void
  scope: ProfileScope
  onScope(scope: ProfileScope): void
  filter: GroupNode
  onToggleCondition(condition: Pick<ConditionNode, 'field' | 'operator' | 'value'>): void
  onChart(field: SheetbaseField): void
  onRole(role: FieldRole, field: SheetbaseField): void
  /** Field ids currently on the chart's x / y / colour channels. */
  roles: Readonly<Partial<Record<FieldRole, string>>>
  canProfile: boolean
}

const TYPE_GLYPH: Record<string, string> = { number: '#', text: 'Aa', boolean: '◑', date: 'D', datetime: 'DT', relationship: '↗' }
const TYPE_NAME: Record<string, string> = { number: 'Number', text: 'Text', boolean: 'Yes / no', date: 'Date', datetime: 'Date & time', relationship: 'Reference' }

type Hint = { kind: 'empty' | 'constant' | 'id' | 'sparse'; label: string }

function hintFor(field: SheetbaseField, profile: FieldProfile | undefined): Hint | null {
  if (!profile || profile.count === 0) return null
  const present = profile.count - profile.nulls
  if (present === 0) return { kind: 'empty', label: 'Empty' }
  if (profile.nulls / profile.count >= 0.5) return { kind: 'sparse', label: `${percent(profile.nulls, profile.count)} missing` }
  if (profile.distinct === 1) return { kind: 'constant', label: 'One value' }
  if (field.dataType === 'text' && profile.distinct === present && present > 20) return { kind: 'id', label: 'Unique per row' }
  return null
}

/** Root-level conditions on a field, keyed the way the profile charts key their bars. */
function activeKeys(filter: GroupNode, field: string): { values: Set<string>; ranges: Set<string>; notNull: boolean } {
  const values = new Set<string>()
  const ranges = new Set<string>()
  let notNull = false
  if (filter.combinator !== 'AND') return { values, ranges, notNull }
  for (const child of filter.children) {
    if (child.type !== 'condition' || child.field !== field) continue
    if (child.operator === 'eq') values.add(String(child.value))
    if (child.operator === 'between' && Array.isArray(child.value) && child.value.length === 2) {
      const [low, high] = child.value as unknown[]
      ranges.add(`${toEdge(low)}|${toEdge(high)}`)
    }
    if (child.operator === 'notNull') notNull = true
  }
  return { values, ranges, notNull }
}

function toEdge(value: unknown): string {
  if (typeof value === 'number') return String(value)
  const stamp = Date.parse(String(value))
  return Number.isNaN(stamp) ? String(value) : String(stamp)
}

/** A bin's filter value: numbers as numbers, dates as ISO strings. */
function rangeValue(field: SheetbaseField, bar: ProfileBar): unknown[] {
  const [low, high] = bar.key.split('|').map(Number) as [number, number]
  if (field.dataType === 'date' || field.dataType === 'datetime') return [new Date(low).toISOString(), new Date(high).toISOString()]
  return [low, high]
}

function boolValue(field: SheetbaseField, label: string): unknown {
  return field.dataType === 'boolean' ? label === 'true' : field.dataType === 'number' ? Number(label) : label
}

export function FieldBrowser(props: FieldBrowserProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? props.fields.filter((field) => field.label.toLowerCase().includes(needle) || field.id.toLowerCase().includes(needle)) : props.fields
  }, [props.fields, query])
  const hints = useMemo(() => {
    const counts = { empty: 0, sparse: 0, constant: 0, id: 0 }
    for (const field of props.fields) {
      const hint = hintFor(field, props.profiles.get(field.id))
      if (hint) counts[hint.kind] += 1
    }
    return counts
  }, [props.fields, props.profiles])
  const completeness = useMemo(() => {
    let cells = 0
    let missing = 0
    for (const profile of props.profiles.values()) { cells += profile.count; missing += profile.nulls }
    return cells ? 1 - missing / cells : null
  }, [props.profiles])

  return (
    <div className="sbs-fields">
      <div className="sbs-overview">
        <div className="sbs-overview-title" title={props.tableLabel}>{props.tableLabel}</div>
        <dl className="sbs-overview-stats">
          <div><dt>Rows</dt><dd>{formatCount(props.tableRows)}</dd></div>
          <div><dt>Matching</dt><dd>{formatCount(props.matchingRows)}</dd></div>
          <div><dt>Fields</dt><dd>{props.fields.length}</dd></div>
          <div><dt>Complete</dt><dd>{completeness === null ? '—' : percent(completeness, 1)}</dd></div>
        </dl>
        {(hints.empty > 0 || hints.sparse > 0 || hints.constant > 0 || hints.id > 0) && (
          <p className="sbs-overview-hints">
            {[
              hints.sparse + hints.empty > 0 && `${hints.sparse + hints.empty} mostly missing`,
              hints.constant > 0 && `${hints.constant} with one value`,
              hints.id > 0 && `${hints.id} unique per row`,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <div className="sbs-fields-tools">
        <input className="sb-input sbs-search" type="search" placeholder={`Search ${props.fields.length} fields`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search fields" />
        {props.canProfile && (
          <div className="sb-segmented sbs-scope" role="radiogroup" aria-label="Profile rows">
            <button type="button" role="radio" aria-checked={props.scope === 'filtered'} className={props.scope === 'filtered' ? 'active' : ''} onClick={() => props.onScope('filtered')} title="Profile only the rows that match the current filters">Filtered</button>
            <button type="button" role="radio" aria-checked={props.scope === 'all'} className={props.scope === 'all' ? 'active' : ''} onClick={() => props.onScope('all')} title="Profile every row in the table">All rows</button>
          </div>
        )}
      </div>
      {props.error && (
        <div className="sbs-note sbs-note--error">Profiling failed: {props.error} <button type="button" className="sb-btn" onClick={props.onRetry}>Retry</button></div>
      )}
      <ul className={`sbs-field-list${props.loading ? ' is-loading' : ''}`} aria-busy={props.loading}>
        {visible.map((field) => {
          const profile = props.profiles.get(field.id)
          const expanded = open === field.id
          const active = activeKeys(props.filter, field.id)
          const categorical = isCategorical(field, profile)
          const bars = profile ? (categorical || !profile.histogram ? topBars(profile, active.values) : histogramBars(field, profile, active.ranges)) : []
          const hint = hintFor(field, profile)
          const filtered = active.values.size + active.ranges.size + (active.notNull ? 1 : 0) > 0
          const roleBadges = (Object.entries(props.roles) as [FieldRole, string | undefined][]).filter(([, id]) => id === field.id).map(([role]) => role)
          return (
            <li key={field.id} className={`sbs-field${expanded ? ' is-open' : ''}`}>
              <button type="button" className="sbs-field-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : field.id)}>
                <span className={`sbs-glyph sbs-glyph--${field.dataType}`} title={TYPE_NAME[field.dataType]}>{TYPE_GLYPH[field.dataType] ?? '?'}</span>
                <span className="sbs-field-name" title={field.label}>{field.label}</span>
                {roleBadges.map((role) => <span key={role} className="sbs-role" title={`On the chart's ${role === 'color' ? 'colour' : `${role} axis`}`}>{role === 'color' ? 'colour' : `${role} axis`}</span>)}
                {filtered && <span className="sbs-filtered" title="Filtered">●</span>}
                {hint && <span className={`sbs-hint sbs-hint--${hint.kind}`}>{hint.label}</span>}
                <Sparkline bars={bars} label={profile ? `${field.label} distribution` : 'Not profiled yet'} />
                <span className="sbs-completeness" title={profile ? `${percent(profile.count - profile.nulls, profile.count)} filled` : undefined} aria-hidden="true">
                  <span style={{ ['--w' as string]: profile && profile.count ? `${((profile.count - profile.nulls) / profile.count) * 100}%` : '0%' }} />
                </span>
              </button>
              {expanded && <FieldCard field={field} profile={profile} bars={bars} categorical={categorical} active={active} {...props} />}
            </li>
          )
        })}
        {!visible.length && <li className="sbs-note">No fields match “{query}”.</li>}
      </ul>
    </div>
  )
}

function FieldCard(props: FieldBrowserProps & {
  field: SheetbaseField
  profile: FieldProfile | undefined
  bars: ProfileBar[]
  categorical: boolean
  active: { values: Set<string>; ranges: Set<string>; notNull: boolean }
}) {
  const { field, profile, bars, categorical, active } = props
  if (!profile) return <div className="sbs-card"><p className="sbs-note">{props.loading ? 'Profiling…' : 'No profile for this field.'}</p></div>
  const present = profile.count - profile.nulls
  const numeric = field.dataType === 'number'
  const temporal = field.dataType === 'date' || field.dataType === 'datetime'
  const toggleValue = (bar: ProfileBar) => props.onToggleCondition({ field: field.id, operator: 'eq' as FilterOperator, value: boolValue(field, bar.label) })
  const toggleRange = (bar: ProfileBar) => props.onToggleCondition({ field: field.id, operator: 'between' as FilterOperator, value: rangeValue(field, bar) })
  const stats: [string, string][] = [
    ['Filled', `${formatCount(present)} (${percent(present, profile.count)})`],
    ['Missing', `${formatCount(profile.nulls)} (${percent(profile.nulls, profile.count)})`],
    ['Distinct', `${formatCount(profile.distinct)}${profile.distinctApprox ? ' ≈' : ''}`],
  ]
  if (numeric) {
    stats.push(['Min', formatStat(profile.min ?? null)], ['Median', formatStat(profile.quantiles?.p50 ?? null)], ['Max', formatStat(profile.max ?? null)])
    stats.push(['Mean', formatStat(profile.mean ?? null)], ['Std dev', formatStat(profile.std ?? null)], ['IQR', profile.quantiles ? `${formatStat(profile.quantiles.p25)} – ${formatStat(profile.quantiles.p75)}` : '—'])
  }
  if (temporal) stats.push(['Earliest', formatStat(profile.min ?? null)], ['Latest', formatStat(profile.max ?? null)])
  return (
    <div className="sbs-card">
      <dl className="sbs-stats">
        {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {categorical || !profile.histogram
        ? bars.length > 0 && <ValueBars bars={bars} total={present} distinct={profile.distinct} onPick={toggleValue} />
        : <>
            <BinChart bars={bars} total={present} onPick={toggleRange} />
            <div className="sbs-bin-axis"><span>{formatStat(profile.min ?? null)}</span><span>{formatStat(profile.max ?? null)}</span></div>
          </>}
      <div className="sbs-card-actions">
        <button type="button" className="sb-btn primary" onClick={() => props.onChart(field)}>Chart it</button>
        <button type="button" className={`sb-btn${props.roles.x === field.id ? ' is-on' : ''}`} onClick={() => props.onRole('x', field)} title="Use as the chart's x axis">As x</button>
        {(numeric || !categorical) && <button type="button" className={`sb-btn${props.roles.y === field.id ? ' is-on' : ''}`} onClick={() => props.onRole('y', field)} title="Plot against the current x axis">As y</button>}
        {categorical && (profile.distinct ?? 0) <= CATEGORY_LIMIT * 2 && (
          <button type="button" className={`sb-btn${props.roles.color === field.id ? ' is-on' : ''}`} onClick={() => props.onRole('color', field)} title="Colour the chart by this field">Colour by</button>
        )}
        {profile.nulls > 0 && (
          <button type="button" className={`sb-btn${active.notNull ? ' is-on' : ''}`} aria-pressed={active.notNull} onClick={() => props.onToggleCondition({ field: field.id, operator: 'notNull', value: undefined })} title="Keep only rows where this field has a value">Hide missing</button>
        )}
      </div>
    </div>
  )
}
