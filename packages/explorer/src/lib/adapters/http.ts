import type {
  RemoteHistogram,
  AggregateBucket,
  AggregateQuery,
  AggregateResponse,
  ColumnKind,
  DataAdapter,
  DataRow,
  Dataset,
  RemotePage,
  RemotePageQuery,
} from '../types'
import { HISTOGRAM_BIN, ROW_ID } from '../explore'

export { HISTOGRAM_BIN }

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
 * holds the key, the valueField holds the aggregated value, the bucket's
 * series values land under their own field names (mirroring how
 * client-side `preparedRows` rows still carry every statistical
 * dimension), and the bucket count rides along under the same
 * `__sheetbaseCount` key `preparedRows` emits for client-side aggregates.
 */
export function bucketsToRows(buckets: readonly AggregateBucket[], query: Pick<AggregateQuery, 'groupBy' | 'valueField' | 'seriesBy'>): DataRow[] {
  return buckets.map((bucket, index) => ({
    [query.groupBy]: bucket.key,
    ...(bucket.series ?? {}),
    ...(query.valueField !== undefined ? { [query.valueField]: bucket.value } : {}),
    __sheetbaseCount: bucket.count,
    [ROW_ID]: index,
  }))
}

/**
 * Shape exact server bins into the rows the histogram mark draws: one row
 * per (series × bin) with `x1`/`x2`/`count`, the series value under its own
 * field so `color` picks it up.
 */
export function binsToRows(histogram: RemoteHistogram, seriesField?: string): DataRow[] {
  const rows: DataRow[] = []
  for (const series of histogram.series) {
    series.counts.forEach((count, index) => {
      rows.push({
        x1: histogram.edges[index],
        x2: histogram.edges[index + 1],
        count,
        ...(seriesField && series.key !== null ? { [seriesField]: series.key } : {}),
        [HISTOGRAM_BIN]: true,
        [ROW_ID]: rows.length,
      })
    })
  }
  return rows
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
  const page = async (query: RemotePageQuery, signal?: AbortSignal): Promise<RemotePage> => {
    const params = new URLSearchParams({
      rowStart: String(query.offset),
      rowCount: String(query.limit),
      fieldIds: query.fields.join(','),
    })
    if (query.filter) params.set('filterTree', JSON.stringify(query.filter))
    const response = await fetcher(`${options.baseUrl}/api/table/pages?${params}`, { signal: signal ?? null })
    if (!response.ok) throw new Error(`Page request failed (${response.status})`)
    const body = await response.json() as { records: { recordId: string; values: Record<string, unknown> }[]; totalRows: number; revision?: string }
    return {
      rows: body.records.map((record, index) => ({ ...record.values, [ROW_ID]: query.offset + index })),
      totalRows: body.totalRows,
      revision: body.revision,
    }
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
        remote: { aggregate, page },
      }
    },
  }
}
