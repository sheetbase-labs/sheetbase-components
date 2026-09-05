import { describe, expect, it } from 'vitest'
import { runSql, runSqlAsync } from './sql'
import type { Dataset } from './types'

const dataset: Dataset = {
  name: 'test',
  rows: [
    { team: 'a', score: 10 },
    { team: 'a', score: 20 },
    { team: 'b', score: 30 },
  ],
  columns: [
    { key: 'team', kind: 'string', nullable: false, uniqueCount: 2 },
    { key: 'score', kind: 'number', nullable: false, uniqueCount: 3 },
  ],
  source: 'test',
}

describe('runSql', () => {
  it('returns the dataset untouched for blank input', () => {
    expect(runSql(dataset, '   ')).toBe(dataset)
  })

  it('filters and projects through the ? table', () => {
    const out = runSql(dataset, 'SELECT team, score FROM ? WHERE score >= 20 ORDER BY score')
    expect(out.rows).toEqual([
      { team: 'a', score: 20 },
      { team: 'b', score: 30 },
    ])
    expect(out.columns.map((column) => column.key)).toEqual(['team', 'score'])
    expect(out.source).toBe('test:sql')
  })

  it('re-infers columns from the result shape', () => {
    const out = runSql(dataset, 'SELECT SUM(score) AS overall FROM ?')
    expect(out.columns.map((column) => column.key)).toEqual(['overall'])
  })

  it('throws readable errors for bad SQL', () => {
    expect(() => runSql(dataset, 'SELECT FROM WHERE')).toThrow()
  })
})

describe('runSqlAsync', () => {
  it('matches the synchronous path through the worker fallback', async () => {
    const [sync, asyncResult] = await Promise.all([
      Promise.resolve(runSql(dataset, 'SELECT * FROM ? WHERE team = \'b\'')),
      runSqlAsync(dataset, 'SELECT * FROM ? WHERE team = \'b\''),
    ])
    expect(asyncResult.rows).toEqual(sync.rows)
    expect(asyncResult.columns).toEqual(sync.columns)
  })
})
