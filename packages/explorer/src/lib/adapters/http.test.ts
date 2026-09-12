import { describe, expect, it } from 'vitest'
import type { GroupNode } from 'sheetbase-shared'
import { bucketsToRows, createHttpExplorerAdapter } from './http'
import { ROW_ID } from '../explore'
import type { AggregateResponse } from '../types'

const fields = [
  { key: 'status', kind: 'string' as const, uniqueCount: 3 },
  { key: 'result', kind: 'number' as const, uniqueCount: 100_000 },
]

function fetchReturning(payload: AggregateResponse) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch
  return { calls, fetcher }
}

describe('createHttpExplorerAdapter', () => {
  it('loads a metadata-only dataset carrying the remote capability', async () => {
    const adapter = createHttpExplorerAdapter({ baseUrl: 'http://api.test', datasetId: 'experiments', fields, fetcher: fetchReturning({ buckets: [], totalRows: 0 }).fetcher })
    const dataset = await adapter.load()
    expect(dataset.rows).toEqual([])
    expect(dataset.source).toBe('http:experiments')
    expect(dataset.columns.map((column) => column.key)).toEqual(['status', 'result'])
    expect(dataset.remote).toBeDefined()
  })

  it('posts the dataset id and query to the aggregate route', async () => {
    const { calls, fetcher } = fetchReturning({ buckets: [{ key: 'Complete', count: 10, value: 4.2 }], totalRows: 10 })
    const adapter = createHttpExplorerAdapter({ baseUrl: 'http://api.test', datasetId: 'experiments', fields, fetcher })
    const dataset = await adapter.load()
    const filter: GroupNode = { type: 'group', id: 'g1', combinator: 'AND', children: [{ type: 'condition', id: 'c1', field: 'assay', operator: 'eq', value: 'BCA' }] }
    const response = await dataset.remote!.aggregate({ filter, groupBy: 'status', seriesBy: ['reviewer'], summary: 'mean', valueField: 'result', limit: 5 })
    expect(response.buckets).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://api.test/api/explorer/aggregate')
    expect(calls[0]!.init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>
    expect(body.datasetId).toBe('experiments')
    expect(body.groupBy).toBe('status')
    expect(body.seriesBy).toEqual(['reviewer'])
    expect(body.summary).toBe('mean')
    expect(body.valueField).toBe('result')
    expect(body.limit).toBe(5)
    expect((body.filter as { combinator?: string }).combinator).toBe('AND')
  })

  it('forwards the abort signal and rejects on non-ok responses', async () => {
    const { calls, fetcher } = fetchReturning({ buckets: [], totalRows: 0 })
    const adapter = createHttpExplorerAdapter({ baseUrl: 'http://api.test', datasetId: 'experiments', fields, fetcher })
    const dataset = await adapter.load()
    const controller = new AbortController()
    await dataset.remote!.aggregate({ groupBy: 'status', summary: 'count' }, controller.signal)
    expect(calls[0]!.init?.signal).toBe(controller.signal)

    const failing = createHttpExplorerAdapter({
      baseUrl: 'http://api.test', datasetId: 'experiments', fields,
      fetcher: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    })
    const failingDataset = await failing.load()
    await expect(failingDataset.remote!.aggregate({ groupBy: 'status', summary: 'count' })).rejects.toThrow('500')
  })

  it('fetches a page of raw rows for the Data-tab preview', async () => {
    const calls: Array<{ url: string }> = []
    const fetcher = (async (url: string | URL | Request) => {
      calls.push({ url: String(url) })
      return new Response(JSON.stringify({
        records: [
          { recordId: 'rec-1', values: { status: 'Complete', result: 4.2 } },
          { recordId: 'rec-2', values: { status: 'Review', result: null } },
        ],
        totalRows: 1_000_000,
        revision: 'r7',
      }), { status: 200 })
    }) as typeof fetch
    const adapter = createHttpExplorerAdapter({ baseUrl: 'http://api.test', datasetId: 'experiments', fields, fetcher })
    const dataset = await adapter.load()
    const filter: GroupNode = { type: 'group', id: 'g1', combinator: 'AND', children: [{ type: 'condition', id: 'c1', field: 'assay', operator: 'eq', value: 'BCA' }] }
    const page = await dataset.remote!.page!({ offset: 40, limit: 200, fields: ['status', 'result'], filter })
    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe('http://api.test/api/table/pages')
    expect(url.searchParams.get('rowStart')).toBe('40')
    expect(url.searchParams.get('rowCount')).toBe('200')
    expect(url.searchParams.get('fieldIds')).toBe('status,result')
    expect(JSON.parse(url.searchParams.get('filterTree')!)).toEqual(filter)
    expect(page.rows).toEqual([
      { status: 'Complete', result: 4.2, [ROW_ID]: 40 },
      { status: 'Review', result: null, [ROW_ID]: 41 },
    ])
    expect(page.totalRows).toBe(1_000_000)
    expect(page.revision).toBe('r7')
  })
})

describe('bucketsToRows', () => {
  it('shapes buckets into chart rows mirroring preparedRows output', () => {
    const rows = bucketsToRows(
      [{ key: 'Complete', count: 12, value: 3.5 }, { key: 'Review', count: 4, value: null }],
      { groupBy: 'status', valueField: 'result' },
    )
    expect(rows).toEqual([
      { status: 'Complete', result: 3.5, __sheetbaseCount: 12, [ROW_ID]: 0 },
      { status: 'Review', result: null, __sheetbaseCount: 4, [ROW_ID]: 1 },
    ])
  })

  it('omits the value field for count summaries', () => {
    const rows = bucketsToRows([{ key: 'Ct', count: 7, value: 7 }], { groupBy: 'unit' })
    expect(rows).toEqual([{ unit: 'Ct', __sheetbaseCount: 7, [ROW_ID]: 0 }])
  })

  it('spreads bucket series values into their own fields, mirroring preparedRows dimensions', () => {
    const rows = bucketsToRows(
      [
        { key: 'Complete', series: { reviewer: 'Alice' }, count: 3, value: 1.5 },
        { key: 'Complete', series: { reviewer: 'Bob' }, count: 2, value: 2.5 },
      ],
      { groupBy: 'status', seriesBy: ['reviewer'], valueField: 'result' },
    )
    expect(rows).toEqual([
      { status: 'Complete', reviewer: 'Alice', result: 1.5, __sheetbaseCount: 3, [ROW_ID]: 0 },
      { status: 'Complete', reviewer: 'Bob', result: 2.5, __sheetbaseCount: 2, [ROW_ID]: 1 },
    ])
  })
})
