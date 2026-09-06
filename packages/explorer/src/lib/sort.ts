import type { DataRow } from './types'

/** Shared inspector ordering: numeric when both sides parse, locale-aware text otherwise. */
export function compareCellValues(a: unknown, b: unknown): number {
  const numericA = Number(a)
  const numericB = Number(b)
  return Number.isFinite(numericA) && Number.isFinite(numericB)
    ? numericA - numericB
    : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
}

export function sortRows(rows: DataRow[], key: string, direction: 'asc' | 'desc'): DataRow[] {
  const sorted = [...rows].sort((left, right) => compareCellValues(left[key], right[key]))
  return direction === 'asc' ? sorted : sorted.reverse()
}
