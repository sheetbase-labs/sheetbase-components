import { describe, expect, it } from 'vitest'
import { attachStatement, attachedTables, isSystemSchema, matchesSelector, parseDbTarget } from '../src/attach'

describe('parseDbTarget', () => {
  it('reads Postgres URLs and hides the password', () => {
    const target = parseDbTarget('postgres://reader:s3cret@db.lab:5432/lims?sslmode=require', new Set())
    expect(target).toMatchObject({ kind: 'postgres', alias: 'lims', connection: 'postgres://reader:s3cret@db.lab:5432/lims?sslmode=require' })
    expect(target.display).toBe('postgres://reader:***@db.lab:5432/lims?sslmode=require')
    expect(attachStatement(target)).toBe(`ATTACH 'postgres://reader:s3cret@db.lab:5432/lims?sslmode=require' AS "lims" (TYPE postgres, READ_ONLY)`)
  })

  it('turns MySQL URLs into key=value connection strings', () => {
    const target = parseDbTarget("mysql://lab:p%20w'd@mysql.local:3306/qc?ssl_mode=required", new Set())
    expect(target.kind).toBe('mysql')
    expect(target.connection).toBe("host=mysql.local port=3306 user=lab passwd='p w\\'d' db=qc ssl_mode=required")
    expect(target.display).toBe('mysql://lab:***@mysql.local:3306/qc?ssl_mode=required')
  })

  it('recognises database files and sqlite:// / duckdb:// URLs', () => {
    const taken = new Set<string>()
    expect(parseDbTarget('data/LIMS export.sqlite', taken, '/work')).toMatchObject({ kind: 'sqlite', alias: 'lims_export', connection: '/work/data/LIMS export.sqlite' })
    expect(parseDbTarget('sqlite:///srv/a.db', taken)).toMatchObject({ kind: 'sqlite', alias: 'a', connection: '/srv/a.db' })
    expect(parseDbTarget('warehouse.duckdb', taken, '/work')).toMatchObject({ kind: 'duckdb', alias: 'warehouse' })
    expect(attachStatement(parseDbTarget('x.ddb', taken, '/w'))).toBe(`ATTACH '/w/x.ddb' AS "x" (READ_ONLY)`)
  })

  it('takes a name prefix and keeps aliases unique and unreserved', () => {
    const taken = new Set<string>()
    expect(parseDbTarget('lims=postgres://h/db', taken).alias).toBe('lims')
    expect(parseDbTarget('postgres://h/lims', taken).alias).toBe('lims_2')
    expect(parseDbTarget('main.duckdb', taken, '/w').alias).toBe('main_db')
    expect(parseDbTarget('2026.sqlite', taken, '/w').alias).toBe('db_2026')
  })

  it('rejects what it cannot open', () => {
    expect(() => parseDbTarget('snowflake://acct/db', new Set())).toThrow(/Unsupported database URL/)
    expect(() => parseDbTarget('notes.txt', new Set())).toThrow(/Can't tell/)
  })
})

describe('attached tables', () => {
  it('skips system schemas and qualifies names only when there are several schemas', () => {
    const single = attachedTables('lims', [{ schema: 'public', name: 'assays' }, { schema: 'pg_catalog', name: 'pg_class' }, { schema: 'information_schema', name: 'tables' }])
    expect(single).toEqual([{ id: 'assays', label: 'assays', schema: 'public', name: 'assays', relation: '"lims"."public"."assays"' }])
    const several = attachedTables('lims', [{ schema: 'public', name: 'batches' }, { schema: 'qc', name: 'assays' }])
    expect(several.map((table) => [table.id, table.label])).toEqual([['public_batches', 'public.batches'], ['qc_assays', 'qc.assays']])
    expect(isSystemSchema('PG_TEMP_3')).toBe(true)
    // --table applies first: one chosen table keeps its plain name.
    const picked = attachedTables('lims', [{ schema: 'public', name: 'batches' }, { schema: 'qc', name: 'assays' }], (table) => table.schema === 'qc')
    expect(picked.map((table) => table.id)).toEqual(['assays'])
  })

  it('matches --table by name, schema.name or alias.schema.name', () => {
    const [table] = attachedTables('lims', [{ schema: 'qc', name: 'Assays' }])
    if (!table) throw new Error('expected a table')
    for (const selector of ['assays', 'qc.assays', 'lims.qc.assays', 'LIMS.assays']) expect(matchesSelector(selector, 'lims', table), selector).toBe(true)
    expect(matchesSelector('other.assays', 'lims', table)).toBe(false)
  })
})
