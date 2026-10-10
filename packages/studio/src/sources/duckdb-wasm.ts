import type { DuckDBBundles } from '@duckdb/duckdb-wasm'
import type { SqlEngine } from './sql-source'

/** A DuckDB engine that can also receive files (uploads, JSON rows). */
export interface FileSqlEngine extends SqlEngine {
  /** Make `data` readable by SQL; returns the path to use in `read_*()` calls. */
  registerFile(name: string, data: Uint8Array | string): Promise<string>
  /** Forget a registered file (keeps memory flat after ingestion). */
  dropFile?(name: string): Promise<void>
}

export interface DuckDbWasmOptions {
  /**
   * Where the worker and `.wasm` files load from. Defaults to jsDelivr; pass
   * self-hosted bundles for offline or locked-down (GxP) deployments — see
   * the studio README for the Vite `?url` recipe.
   */
  bundles?: DuckDBBundles
}

/** Narrow Arrow/BigInt values to plain JSON-shaped JS. */
export function plainValue(value: unknown): unknown {
  // Counts and integer columns: beyond 2^53 precision is lost, as in JSON.
  if (typeof value === 'bigint') return Number(value)
  if (value === null || value === undefined) return value ?? null
  if (Array.isArray(value)) return value.map(plainValue)
  // Arrow lists of numbers arrive as typed arrays.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && !(value instanceof Uint8Array)) return Array.from(value as unknown as ArrayLike<number | bigint>, plainValue)
  if (typeof value === 'object') {
    const candidate = value as { toArray?: () => unknown[]; toJSON?: () => unknown }
    if (typeof candidate.toArray === 'function' && !(value instanceof Uint8Array)) return candidate.toArray().map(plainValue)
    if (value instanceof Date) return value.toISOString()
    if (typeof candidate.toJSON === 'function') return plainValue(candidate.toJSON())
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]))
  }
  return value
}

/**
 * DuckDB-WASM in a worker. The module is imported lazily so pages that never
 * open a file or run SQL never download it.
 */
export async function createDuckDbWasmEngine(options: DuckDbWasmOptions = {}): Promise<FileSqlEngine> {
  const duckdb = await import('@duckdb/duckdb-wasm')
  const bundle = await duckdb.selectBundle(options.bundles ?? duckdb.getJsDelivrBundles())
  if (!bundle.mainWorker) throw new Error('DuckDB-WASM bundle has no worker script.')
  // A cross-origin worker script can't be constructed directly; a same-origin
  // blob that imports it can.
  const sameOrigin = typeof location !== 'undefined' && new URL(bundle.mainWorker, location.href).origin === location.origin
  const workerUrl = sameOrigin
    ? bundle.mainWorker
    : URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }))
  const worker = new Worker(workerUrl)
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  if (!sameOrigin) URL.revokeObjectURL(workerUrl)
  const connection = await db.connect()
  return {
    async query(sql) {
      const table = await connection.query(sql)
      return table.toArray().map((row) => plainValue((row as { toJSON(): unknown }).toJSON()) as Record<string, unknown>)
    },
    async registerFile(name, data) {
      if (typeof data === 'string') await db.registerFileText(name, data)
      else await db.registerFileBuffer(name, data)
      return name
    },
    async dropFile(name) {
      await db.dropFile(name)
    },
    dispose() {
      void connection.close().finally(() => db.terminate())
    },
  }
}
