import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildPredicate, type GroupNode } from '@sheetbase-labs/sheetbase-shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DuckDbSource } from '../sources/file'
import { createNodeEngine } from '../test/node-engine'
import { PARITY_CASES, PARITY_FIELDS, PARITY_NOW, PARITY_ROWS } from './parity-cases'
import { filterToSql, quoteLiteral } from './sql-compile'

const FIXTURE = fileURLToPath(new URL('../../fixtures/filter-parity.json', import.meta.url))

interface Fixture {
  now: string
  fields: typeof PARITY_FIELDS
  rows: typeof PARITY_ROWS
  cases: { name: string; filter: GroupNode; expected: string[] }[]
}

function expectedIds(filter: GroupNode): string[] {
  const predicate = buildPredicate(filter)
  return PARITY_ROWS.filter(predicate).map((row) => String(row.id))
}

describe('filter parity fixture', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(PARITY_NOW))
  })
  afterAll(() => vi.useRealTimers())

  it('matches buildPredicate (UPDATE_PARITY=1 regenerates it)', () => {
    const fixture: Fixture = {
      now: PARITY_NOW,
      fields: PARITY_FIELDS,
      rows: PARITY_ROWS,
      cases: PARITY_CASES.map((entry) => ({ ...entry, expected: expectedIds(entry.filter) })),
    }
    if (process.env.UPDATE_PARITY) writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`)
    const stored = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
    expect(stored).toEqual(fixture)
  })
})

describe('DuckDB compiler parity', () => {
  let source: DuckDbSource
  let close: () => void
  const types = Object.fromEntries(PARITY_FIELDS.map((field) => [field.id, field.dataType]))
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
  const now = Date.parse(fixture.now)

  beforeAll(async () => {
    const engine = await createNodeEngine()
    close = engine.close
    source = await DuckDbSource.create({ engine })
    await source.addRows(fixture.rows, {
      name: 'parity',
      id: 'parity',
      fields: fixture.fields.map((field) => ({ ...field, label: field.id })),
    })
  })
  afterAll(() => close?.())

  for (const entry of fixture.cases ?? []) {
    it(entry.name, async () => {
      const where = filterToSql(entry.filter, types, { now })
      const rows = await source.engine.query(`SELECT id FROM parity WHERE ${where} ORDER BY id`)
      expect(rows.map((row) => row.id)).toEqual(entry.expected)
    })
  }

  it('readable mode emits SQL that parses', async () => {
    // Readable SQL is for people (typed columns, no loose casts), so only
    // its syntax is checked — values may not cast on mixed-type columns.
    for (const entry of fixture.cases ?? []) {
      const where = filterToSql(entry.filter, types, { now, mode: 'readable' })
      const [row] = await source.engine.query(`SELECT json_serialize_sql(${quoteLiteral(`SELECT * FROM parity WHERE ${where}`)}) AS ast`)
      expect(JSON.parse(String(row?.ast)).error, `${entry.name}: ${where}`).toBe(false)
    }
  })

  it('rejects operators it cannot evaluate', () => {
    expect(() => filterToSql({ type: 'group', id: 'g', combinator: 'AND', children: [{ type: 'condition', id: 'c', field: 'id', operator: 'regex' as never, value: 'x' }] }, types)).toThrow(/Unsupported/)
  })
})
