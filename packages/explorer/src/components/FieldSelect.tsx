import type { ColumnMeta } from '../lib/types'

interface Props {
  label: string
  value?: string
  columns: ColumnMeta[]
  allowNone?: boolean
  onChange(value?: string): void
}

function typeGlyph(kind?: ColumnMeta['kind']) {
  if (kind === 'number') return '#'
  if (kind === 'date') return '◷'
  if (kind === 'boolean') return '✓'
  return 'A'
}

export function FieldSelect({ label, value, columns, allowNone = true, onChange }: Props) {
  const selected = columns.find((column) => column.key === value)

  return (
    <label className="field-control">
      <span className="field-label">{label}</span>
      <span className={`field-select-shell ${value ? 'has-value' : ''}`}>
        <span className={`field-type type-${selected?.kind ?? 'empty'}`}>{value ? typeGlyph(selected?.kind) : '—'}</span>
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
          {allowNone && <option value="">None</option>}
          {columns.map((column) => <option key={column.key} value={column.key}>{column.key}</option>)}
        </select>
      </span>
    </label>
  )
}
