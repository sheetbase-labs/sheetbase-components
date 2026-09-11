import type {
  AggregateBucket,
  AggregateQuery,
  AggregateResponse,
  ColumnKind,
  DataAdapter,
  DataRow,
  Dataset,
} from '../types'
import { ROW_ID } from '../explore'

export interface HttpExplorerField {
  key: string
  kind: ColumnKind
  nullable?: boolean
  uniqueCount?: number
}

export interface HttpExplorerAdapterOptions {
  /** e.g. "http://127.0.0.1:8787" — the aggregate route lives at `${baseUrl}/api/explorer/aggregate`. */
  baseUrl: string
  datasetId: string
  /** Dataset label shown in the source menu and titles. Defaults to datasetId. */
  name?: string
  /** Column metadata the host already knows — no schema endpoint is required. */
  fields: HttpExplorerField[]
  /** Injectable for tests; defaults to global fetch. */
  fetcher?: typeof fetch
}

/**
 * Shape one server bucket into the row a chart expects: the groupBy field
 * holds the key, the valueField holds the aggregated value, and the bucket
 * count rides along under the same `__sheetbaseCount` key `preparedRows`
 * emits for client-side aggregates.
 */
export function bucketsToRows(buckets: readonly AggregateBucket[], query: Pick<AggregateQuery, 'groupBy' | 'valueField'>): DataRow[] {
  return buckets.map((bucket, index) => ({
    [query.groupBy]: bucket.key,
    ...(query.valueField !== undefined ? { [query.valueField]: bucket.value } : {}),
    __sheetbaseCount: bucket.count,
    [ROW_ID]: index,
  }))
}

/**
 * A `DataAdapter` for a dataset whose rows live behind the aggregate
 * endpoint: `load()` returns column metadata only (`rows: []`) with a
 * `remote` capability the App uses to fetch aggregated buckets per spec.
 */
export function createHttpExplorerAdapter(options: HttpExplorerAdapterOptions): DataAdapter {
  const fetcher = options.fetcher ?? fetch
  const aggregate = async (query: AggregateQuery, signal?: AbortSignal): Promise<AggregateResponse> => {
    const response = await fetcher(`${options.baseUrl}/api/explorer/aggregate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ datasetId: options.datasetId, ...query }),
      signal: signal ?? null,
    })
    if (!response.ok) throw new Error(`Aggregate request failed (${response.status})`)
    return await response.json() as AggregateResponse
  }
  return {
    id: `http:${options.datasetId}`,
    label: options.name ?? options.datasetId,
    async load(): Promise<Dataset> {
      return {
        name: options.name ?? options.datasetId,
        rows: [],
        columns: options.fields.map((field) => ({
          key: field.key,
          kind: field.kind,
          nullable: field.nullable ?? true,
          uniqueCount: field.uniqueCount ?? 0,
        })),
        source: `http:${options.datasetId}`,
        remote: { aggregate },
      }
    },
  }
}
