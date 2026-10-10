/**
 * Stand-in for the in-browser engines (DuckDB-WASM, Parquet/Excel readers) in
 * builds served by the Python package: there, uploads and SQL go to the
 * server, so the browser never needs its own engine.
 */
function unavailable(): never {
  throw new Error('This build sends files and SQL to the server; the in-browser engine is not included.')
}

export const selectBundle = unavailable
export const getJsDelivrBundles = unavailable
export const parquetReadObjects = unavailable
export const compressors = {}
export class AsyncDuckDB { constructor() { unavailable() } }
export class VoidLogger {}
export default unavailable
