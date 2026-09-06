import { bench, describe } from 'vitest'
import { datasetFromFile } from './adapters/file'
import { runSql } from './sql'
import type { Dataset } from './types'

function makeDataset(count: number): Dataset {
  const rows = Array.from({ length: count }, (_, index) => ({
    team: `g${index % 50}`,
    score: (index * 48271) % 1000,
  }))
  return {
    name: 'bench',
    rows,
    columns: [
      { key: 'team', kind: 'string', nullable: false, uniqueCount: 50 },
      { key: 'score', kind: 'number', nullable: false, uniqueCount: 1000 },
    ],
    source: 'bench',
  }
}

describe('query and ingest paths', () => {
  const data = makeDataset(100_000)
  const csv = ['team,score', ...data.rows.map((row) => `${row.team},${row.score}`)].join('\n')

  bench('alasql filter over 100k rows', () => {
    runSql(data, 'SELECT * FROM ? WHERE score > 100 AND team <> \'g7\'')
  })

  bench('alasql group aggregation over 100k rows', () => {
    runSql(data, 'SELECT team, AVG(score) AS mean FROM ? GROUP BY team')
  })

  bench('parse 100k-row CSV with type inference', async () => {
    await datasetFromFile(new File([csv], 'bench.csv', { type: 'text/csv' }))
  })
})
