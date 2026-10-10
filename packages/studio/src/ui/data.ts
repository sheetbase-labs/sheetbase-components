import type { ColumnKind, Dataset } from '@sheetbase-labs/sheetbase-explorer'
import { ROW_ID } from '@sheetbase-labs/sheetbase-explorer'
import type { FieldDataType, FieldProfile, StudioDataSource, TableInfo } from '@sheetbase-labs/sheetbase-shared'
import type { DatasetPage, PagedDataAdapter, Scalar } from '@sheetbase-labs/sheetbase-table'

export type Row = Record<string, unknown>

export function columnKind(dataType: FieldDataType): ColumnKind {
  if (dataType === 'number') return 'number'
  if (dataType === 'boolean') return 'boolean'
  if (dataType === 'date' || dataType === 'datetime') return 'date'
  return 'string'
}

/** Pull every row of a small table (in chunks) so exploration runs locally. */
export async function loadAllRows(
  source: StudioDataSource,
  table: TableInfo,
  signal: AbortSignal,
  onProgress?: (loaded: number) => void,
): Promise<Row[]> {
  const fieldIds = table.fields.map((field) => field.id)
  const rows: Row[] = []
  // Servers may cap a page below what was asked for: advance by what came
  // back, and stop only at the reported total (or an empty page).
  const chunk = 10_000
  for (;;) {
    const page = await source.page(table.id, { rowStart: rows.length, rowCount: chunk, fieldIds }, signal)
    for (const record of page.records) rows.push(record.values)
    onProgress?.(rows.length)
    if (page.records.length === 0 || rows.length >= page.totalRows) break
  }
  return rows
}

function scalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

/** Read-only table adapter over a studio source — the grid pages through it. */
export function sourcePagedAdapter(source: StudioDataSource, tableId: string): PagedDataAdapter {
  return {
    resolve: () => null,
    async commit() {
      throw new Error('The studio is read-only.')
    },
    async fetchPage(request, signal): Promise<DatasetPage> {
      const page = await source.page(tableId, {
        rowStart: request.rowStart,
        rowCount: request.rowCount,
        fieldIds: request.fieldIds,
        sort: request.sort,
        filters: request.filters,
        filterLogic: request.filterLogic,
        filterTree: request.filterTree,
      }, signal)
      return {
        request,
        totalRows: page.totalRows,
        revision: page.revision ?? '1',
        records: page.records.map((record) => ({
          recordId: record.recordId,
          values: Object.fromEntries(Object.entries(record.values).map(([key, value]) => [key, scalar(value)])),
        })),
      }
    },
  }
}

/** The explorer's view of a table: local rows, or the source's remote capabilities. */
export function explorerDataset(
  source: StudioDataSource,
  table: TableInfo,
  rows: readonly Row[] | null,
  profiles: ReadonlyMap<string, FieldProfile>,
): Dataset {
  const columns = table.fields.map((field) => ({
    key: field.id,
    kind: columnKind(field.dataType),
    nullable: field.nullable ?? true,
    uniqueCount: profiles.get(field.id)?.distinct ?? 0,
  }))
  if (rows) return { name: table.label, rows: rows as Row[], columns, source: `${source.kind}:${table.id}` }
  return {
    name: table.label,
    rows: [],
    columns,
    source: `${source.kind}:${table.id}`,
    remote: {
      aggregate: (query, signal) => source.aggregate(table.id, query, signal),
      page: async (query, signal) => {
        const page = await source.page(table.id, { rowStart: query.offset, rowCount: query.limit, fieldIds: query.fields, filterTree: query.filter }, signal)
        return {
          rows: page.records.map((record, index) => ({ ...record.values, [ROW_ID]: query.offset + index })),
          totalRows: page.totalRows,
          revision: page.revision,
        }
      },
      ...(source.capabilities.sample && source.sample ? {
        sample: async (query, signal) => {
          const response = await source.sample?.(table.id, { fields: query.fields, n: query.n, filter: query.filter }, signal)
          if (!response) throw new Error('Sampling is unavailable.')
          return { rows: response.rows as Row[], totalRows: response.totalRows, sampled: response.sampled }
        },
      } : {}),
      ...(source.capabilities.histogram && source.histogram ? {
        histogram: async (query, signal) => {
          const response = await source.histogram?.(table.id, { field: query.field, bins: query.bins, binWidth: query.binWidth, by: query.by, filter: query.filter }, signal)
          if (!response) throw new Error('Binning is unavailable.')
          return { edges: [...response.edges], series: response.series.map((series) => ({ key: series.key, counts: [...series.counts] })), totalRows: response.totalRows, nulls: response.nulls }
        },
      } : {}),
    },
  }
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString()
}

/** Compact numbers for stat grids: 3 significant figures, thousands separators for big values. */
export function formatStat(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.replace(/T00:00:00\.000Z$/, '').replace(/\.000Z$/, 'Z')
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) return value.toExponential(2)
  if (Number.isInteger(value)) return value.toLocaleString()
  return Number(value.toPrecision(abs >= 1000 ? 6 : 4)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export function percent(part: number, whole: number): string {
  if (!whole) return '—'
  const value = (part / whole) * 100
  if (value > 0 && value < 0.1) return '<0.1%'
  if (value < 100 && value > 99.9) return '>99.9%'
  // Never round a gap away: 99.5% filled must not read as complete.
  if (value < 100 && value >= 99.5) return `${value.toFixed(1)}%`
  return `${value.toFixed(value < 10 ? 1 : 0)}%`
}
