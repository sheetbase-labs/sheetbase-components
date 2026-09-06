import type { ColumnKind, ColumnMeta, DataRow } from './types'

function classify(values: unknown[]): ColumnKind {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '')
  if (!present.length) return 'string'
  if (present.every((value) => typeof value === 'number' && Number.isFinite(value))) return 'number'
  if (present.every((value) => typeof value === 'boolean')) return 'boolean'
  if (present.every((value) => value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))))) return 'date'
  return 'string'
}

export function inferColumns(rows: DataRow[]): ColumnMeta[] {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  return keys.map((key) => {
    const values = rows.map((row) => row[key])
    return {
      key,
      kind: classify(values),
      nullable: values.some((value) => value === null || value === undefined || value === ''),
      uniqueCount: new Set(values.map((value) => String(value))).size,
    }
  })
}
