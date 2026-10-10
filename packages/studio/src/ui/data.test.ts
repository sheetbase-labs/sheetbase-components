import type { PageQuery, StudioDataSource, TableInfo } from '@sheetbase-labs/sheetbase-shared'
import { describe, expect, it } from 'vitest'
import { loadAllRows } from './data'

describe('loadAllRows', () => {
  it('keeps paging when the source caps pages below the request', async () => {
    const total = 12_345
    const calls: PageQuery[] = []
    const source = {
      page: async (_table: string, query: PageQuery) => {
        calls.push(query)
        const count = Math.min(5000, query.rowCount, total - query.rowStart)
        return { totalRows: total, records: Array.from({ length: Math.max(0, count) }, (_, index) => ({ recordId: String(query.rowStart + index), values: { i: query.rowStart + index } })) }
      },
    } as unknown as StudioDataSource
    const table = { id: 't', label: 't', rowCount: total, kind: 'table', fields: [{ id: 'i', label: 'i', dataType: 'number' }] } as TableInfo
    const rows = await loadAllRows(source, table, new AbortController().signal)
    expect(rows).toHaveLength(total)
    expect(rows[total - 1]).toEqual({ i: total - 1 })
    expect(calls.map((call) => call.rowStart)).toEqual([0, 5000, 10_000])
  })
})
