import { DuckDBInstance } from '@duckdb/node-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openStudio, type OpenedStudio } from '../src/studio'
import { extensionPath, hasExtension } from './support'

/**
 * Live database checks. Set a URL to a scratch database the test may write
 * to (CI runs Postgres and MySQL service containers):
 *   SHEETBASE_TEST_POSTGRES=postgresql://postgres@127.0.0.1:5432/postgres
 *   SHEETBASE_TEST_MYSQL=mysql://root:root@127.0.0.1:3306/studio
 * Seeding goes through DuckDB's own connectors, attached read-write here only.
 */
const servers = [
  { kind: 'postgres', url: process.env.SHEETBASE_TEST_POSTGRES, extension: 'postgres_scanner', type: 'postgres' },
  { kind: 'mysql', url: process.env.SHEETBASE_TEST_MYSQL, extension: 'mysql_scanner', type: 'mysql' },
] as const

function mysqlKeyValue(url: string): string {
  const parsed = new URL(url)
  return [`host=${parsed.hostname}`, `port=${parsed.port || '3306'}`, `user=${decodeURIComponent(parsed.username)}`, parsed.password ? `passwd=${decodeURIComponent(parsed.password)}` : '', `db=${parsed.pathname.slice(1)}`].filter(Boolean).join(' ')
}

for (const server of servers) {
  describe.skipIf(!server.url || !hasExtension(server.extension))(`live ${server.kind}`, () => {
    let studio: OpenedStudio

    beforeAll(async () => {
      const instance = await DuckDBInstance.create(':memory:', { autoinstall_known_extensions: 'false', autoload_known_extensions: 'false' })
      const connection = await instance.connect()
      await connection.run(`LOAD '${await extensionPath(server.extension)}'`)
      const target = server.kind === 'mysql' ? mysqlKeyValue(server.url as string) : (server.url as string)
      await connection.run(`ATTACH '${target}' AS seed (TYPE ${server.type})`)
      await connection.run('DROP TABLE IF EXISTS seed.studio_assays')
      await connection.run("CREATE TABLE seed.studio_assays AS SELECT range::INTEGER AS id, 'B' || (1000 + range % 5) AS batch, CASE WHEN range % 9 = 0 THEN NULL ELSE range * 1.5 END AS titer, range % 4 <> 0 AS passed FROM range(200)")
      connection.closeSync()
      instance.closeSync()
      studio = await openStudio({ databases: [`lab=${server.url}`], tables: ['studio_assays'], extensionPath })
    })
    afterAll(() => studio?.close())

    it('lists only the chosen table, uncounted', async () => {
      const tables = await studio.source.catalog()
      expect(tables.map((table) => table.id)).toEqual(['studio_assays'])
      expect(tables[0]?.rowCount).toBeNull()
      expect(tables[0]?.fields.map((field) => [field.id, field.dataType])).toEqual([['id', 'number'], ['batch', 'text'], ['titer', 'number'], ['passed', 'boolean']])
    })

    it('pages, filters, aggregates and profiles at the source', async () => {
      const page = await studio.source.page('studio_assays', {
        rowStart: 0, rowCount: 3, fieldIds: ['id', 'titer'], sort: [{ fieldId: 'id', direction: 'asc' }],
        filterTree: { type: 'group', id: 'g', combinator: 'AND', children: [{ type: 'condition', id: 'c', field: 'passed', operator: 'eq', value: true }] },
      })
      expect(page.totalRows).toBe(150)
      expect(page.records.map((record) => record.values)).toEqual([{ id: 1, titer: 1.5 }, { id: 2, titer: 3 }, { id: 3, titer: 4.5 }])
      const groups = await studio.source.aggregate('studio_assays', { groupBy: 'batch', summary: 'count' })
      expect(groups.buckets.map((bucket) => [bucket.key, bucket.count])).toEqual([['B1000', 40], ['B1001', 40], ['B1002', 40], ['B1003', 40], ['B1004', 40]])
      const profile = await studio.source.profile?.('studio_assays', { fields: ['titer'], bins: 4, top: 0 })
      expect(profile?.profiles[0]).toMatchObject({ field: 'titer', count: 200, nulls: 23 })
    })

    it('stays read-only', async () => {
      await expect(studio.engine.exec('DELETE FROM lab.studio_assays')).rejects.toThrow(/read-only|read only/i)
      await expect(studio.source.sql('SELECT count(*) AS n FROM lab.studio_assays')).resolves.toMatchObject({ kind: 'query', rowCount: 1 })
    })
  })
}
