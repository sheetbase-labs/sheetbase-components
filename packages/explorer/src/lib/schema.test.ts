import { describe, expect, it } from 'vitest'
import { inferColumns } from './schema'

describe('inferColumns', () => {
  it('classifies numbers, text, booleans and ISO dates', () => {
    const columns = inferColumns([
      { n: 1, s: 'a', b: true, d: '2026-01-15' },
      { n: 2.5, s: 'b', b: false, d: '2026-03-01' },
    ])
    const kind = (key: string) => columns.find((column) => column.key === key)?.kind
    expect(kind('n')).toBe('number')
    expect(kind('s')).toBe('string')
    expect(kind('b')).toBe('boolean')
    expect(kind('d')).toBe('date')
  })

  it('unions keys and tracks nullability and cardinality', () => {
    const columns = inferColumns([{ a: 1 }, { a: null, b: '' }, { a: 1, b: 'x' }])
    const a = columns.find((column) => column.key === 'a')!
    expect(a.nullable).toBe(true)
    expect(a.uniqueCount).toBe(2)
    expect(columns.map((column) => column.key).sort()).toEqual(['a', 'b'])
  })

  it('falls back to string for empty or mixed input', () => {
    expect(inferColumns([])).toEqual([])
    expect(inferColumns([{ v: null }, { v: undefined }])[0]?.kind).toBe('string')
    expect(inferColumns([{ v: 1 }, { v: 'x' }])[0]?.kind).toBe('string')
  })
})
