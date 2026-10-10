import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { plainValue, quoteLiteral, type FileSqlEngine } from '@sheetbase-labs/sheetbase-studio/node'

/** A native DuckDB connection with a private working directory for uploads and spill files. */
export interface NativeEngine extends FileSqlEngine {
  /** Where uploads are written before DuckDB reads them. */
  readonly uploadDir: string
  /** Run a statement and ignore its result. */
  exec(sql: string): Promise<void>
  /** Let DuckDB keep reading this file after lockdown (a file opened by path). */
  allowPath(path: string): void
  /**
   * After setup: no file or network access beyond the upload and spill
   * directories and the files opened by path, and no configuration changes
   * — so user SQL can't read other files, reach the network or undo this.
   */
  lockDown(): Promise<void>
  close(): void
}

export async function createNativeEngine(): Promise<NativeEngine> {
  const workDir = mkdtempSync(join(tmpdir(), 'sheetbase-studio-'))
  const uploadDir = join(workDir, 'uploads')
  const spillDir = join(workDir, 'spill')
  mkdirSync(uploadDir)
  mkdirSync(spillDir)
  const instance = await DuckDBInstance.create(':memory:', {
    // Never fetch anything at runtime: connectors ship inside the binary.
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    temp_directory: spillDir,
  })
  const connection = await instance.connect()
  const allowedPaths: string[] = []
  let closed = false

  const query = async (sql: string) => {
    const reader = await connection.runAndReadAll(sql)
    return reader.getRowObjectsJS().map((row) => plainValue(row) as Record<string, unknown>)
  }
  const list = (items: readonly string[]) => `[${items.map(quoteLiteral).join(', ')}]`

  return {
    uploadDir,
    query,
    async exec(sql) {
      await connection.run(sql)
    },
    async registerFile(name, data) {
      const path = join(uploadDir, name)
      writeFileSync(path, data)
      return path
    },
    async dropFile(path) {
      rmSync(path, { force: true })
    },
    allowPath(path) {
      allowedPaths.push(path)
    },
    async lockDown() {
      await connection.run(`SET allowed_directories = ${list([uploadDir + sep, spillDir + sep])}`)
      if (allowedPaths.length) await connection.run(`SET allowed_paths = ${list(allowedPaths)}`)
      await connection.run('SET enable_external_access = false')
      await connection.run('SET lock_configuration = true')
    },
    close() {
      if (closed) return
      closed = true
      connection.closeSync()
      instance.closeSync()
      rmSync(workDir, { recursive: true, force: true })
    },
  }
}
