import { runSql } from './sql'
import type { DataRow, Dataset } from './types'

export interface SqlWorkerRequest {
  id: number
  dataset: Dataset
  sql: string
}

export interface SqlWorkerResponse {
  id: number
  ok: boolean
  rows?: DataRow[]
  error?: string
}

/** Runs the alasql query off the main thread; the host builds the Dataset. */
self.addEventListener('message', (event: Event) => {
  const { id, dataset, sql } = (event as MessageEvent<SqlWorkerRequest>).data
  try {
    const result = runSql(dataset, sql)
    self.postMessage({ id, ok: true, rows: result.rows } satisfies SqlWorkerResponse)
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies SqlWorkerResponse)
  }
})
