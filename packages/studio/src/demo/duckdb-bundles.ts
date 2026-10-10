import type { DuckDbBundles } from '../sources/duckdb-wasm'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'

/** Self-hosted DuckDB-WASM: the app serves its own worker and wasm (offline-safe). */
export const localDuckDbBundles: DuckDbBundles = {
  mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
  eh: { mainModule: ehModule, mainWorker: ehWorker },
}
