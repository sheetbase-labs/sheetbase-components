import { describe, expect, it } from 'vitest'
import { datasetFromFile } from './file'

describe('datasetFromFile', () => {
  it('parses CSV with inferred numbers and nulls', async () => {
    const file = new File(['name,value\nAlpha,1\nBeta,\n'], 'data.csv', { type: 'text/csv' })
    const dataset = await datasetFromFile(file)
    expect(dataset.name).toBe('data.csv')
    expect(dataset.rows).toEqual([
      { name: 'Alpha', value: 1 },
      { name: 'Beta', value: null },
    ])
    expect(dataset.columns.find((column) => column.key === 'value')?.kind).toBe('number')
  })

  it('parses JSON arrays of objects', async () => {
    const file = new File([JSON.stringify([{ a: 1 }, { a: 2 }])], 'data.json', { type: 'application/json' })
    const dataset = await datasetFromFile(file)
    expect(dataset.rows).toHaveLength(2)
    expect(dataset.columns.find((column) => column.key === 'a')?.kind).toBe('number')
  })

  it('rejects non-array JSON', async () => {
    const file = new File([JSON.stringify({ a: 1 })], 'data.json', { type: 'application/json' })
    await expect(datasetFromFile(file)).rejects.toThrow('array of objects')
  })
})
