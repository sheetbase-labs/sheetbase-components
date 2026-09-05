import { describe, expect, it } from 'vitest'
import { compareCellValues, sortRows } from './sort'

describe('compareCellValues', () => {
  it('orders numerically when both sides parse', () => {
    expect(compareCellValues(2, 10)).toBeLessThan(0)
    expect(compareCellValues('2', 10)).toBeLessThan(0)
    expect(compareCellValues(10, 10)).toBe(0)
  })

  it('falls back to locale text order otherwise', () => {
    expect(compareCellValues('b', 'a')).toBeGreaterThan(0)
    expect(compareCellValues(null, 'a')).toBeLessThan(0)
  })
})

describe('sortRows', () => {
  const rows = [{ v: 3 }, { v: 1 }, { v: 2 }]

  it('sorts both directions without mutating input', () => {
    expect(sortRows(rows, 'v', 'asc').map((row) => row.v)).toEqual([1, 2, 3])
    expect(sortRows(rows, 'v', 'desc').map((row) => row.v)).toEqual([3, 2, 1])
    expect(rows.map((row) => row.v)).toEqual([3, 1, 2])
  })
})
