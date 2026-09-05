import alasql from 'alasql'
import { inferColumns } from './schema'
import type { Dataset, DataRow } from './types'

export function runSql(dataset: Dataset, sql: string): Dataset {
  const trimmed = sql.trim()
  if (!trimmed) return dataset
  const rows = alasql(trimmed, [dataset.rows]) as DataRow[]
  if (!Array.isArray(rows)) throw new Error('The query must return rows.')
  return {
    ...dataset,
    name: `${dataset.name} · query`,
    rows,
    columns: inferColumns(rows),
    source: `${dataset.source}:sql`,
  }
}

export interface SqlWorkerResponse {
  id: number
  ok: boolean
  rows?: DataRow[]
  error?: string
}

let sqlWorker: Worker | undefined
let nextSqlRequestId = 1
const pendingSqlRequests = new Map<number, { resolve(rows: DataRow[]): void; reject(error: Error): void }>()

function getSqlWorker(): Worker | undefined {
  if (sqlWorker) return sqlWorker
  try {
    const created = new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<SqlWorkerResponse>) => {
      const pending = pendingSqlRequests.get(event.data.id)
      if (!pending) return
      pendingSqlRequests.delete(event.data.id)
      if (event.data.ok) pending.resolve(event.data.rows ?? [])
      else pending.reject(new Error(event.data.error ?? 'The query failed.'))
    }
    sqlWorker = created
    return created
  } catch {
    return undefined
  }
}

/**
 * Runs the query in a module worker so large datasets never block chart
 * interaction. Falls back to the synchronous path where workers are
 * unavailable (tests, SSR).
 */
export function runSqlAsync(dataset: Dataset, sql: string): Promise<Dataset> {
  const worker = typeof Worker === 'undefined' ? undefined : getSqlWorker()
  if (!worker) return Promise.resolve(runSql(dataset, sql))
  return new Promise<Dataset>((resolve, reject) => {
    const id = nextSqlRequestId++
    pendingSqlRequests.set(id, {
      resolve: (rows) => resolve({
        ...dataset,
        name: `${dataset.name} · query`,
        rows,
        columns: inferColumns(rows),
        source: `${dataset.source}:sql`,
      }),
      reject,
    })
    worker.postMessage({ id, dataset, sql })
  })
}
