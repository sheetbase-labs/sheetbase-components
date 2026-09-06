import { describe, expect, it } from 'vitest'
import { decimatePoints } from './chart'
import type { DataRow } from './types'

function rows(count: number): DataRow[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, y: index * 2 }))
}

describe('decimatePoints', () => {
  it('returns small inputs untouched', () => {
    const input = rows(100)
    expect(decimatePoints(input, 8000)).toBe(input)
  })

  it('caps large inputs while preserving order and endpoints', () => {
    const out = decimatePoints(rows(20000), 8000)
    expect(out).toHaveLength(8000)
    expect(out[0]).toMatchObject({ x: 0 })
    expect(out[7999]).toMatchObject({ x: 19997 })
    const xs = out.map((row) => Number(row.x))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('is deterministic across calls', () => {
    const input = rows(50000)
    expect(decimatePoints(input, 1000)).toEqual(decimatePoints(input, 1000))
  })
})
