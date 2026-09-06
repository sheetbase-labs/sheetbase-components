import { describe, expect, it } from 'vitest'
import {
  CURRENT_EXPLORATION_VERSION, createLocalStorageExplorerAdapter, decodeShareHash,
  encodeShareHash, migrateExplorerState, normaliseExplorerState, type PersistedExplorerState,
} from './persistence'
import type { ChartSpec } from './types'

const baseSpec: ChartSpec = {
  kind: 'scatter', x: 'day', y: 'response', aggregate: 'none', showPoints: true, showGrid: true,
  pointSize: 5, pointOpacity: 0.9, lineWidth: 2, lineOpacity: 0.9,
  fillOpacity: 0.8, barGap: 2, barRadius: 3, barLayout: 'grouped', histogramBins: 12, palette: ['#7652ef'],
}

function fallback(): PersistedExplorerState {
  return { version: CURRENT_EXPLORATION_VERSION, theme: 'light', spec: baseSpec, sql: 'SELECT * FROM ?', saved: [], updatedAt: '2026-01-01T00:00:00.000Z' }
}

describe('migrateExplorerState', () => {
  it('upgrades v1 states with a light theme', () => {
    const migrated = migrateExplorerState({ version: 1, spec: baseSpec, sql: 'SELECT 1' }) as Record<string, unknown>
    expect(migrated.version).toBe(2)
    expect(migrated.theme).toBe('light')
    expect(migrated.sql).toBe('SELECT 1')
  })

  it('refuses states from newer versions', () => {
    expect(migrateExplorerState({ version: 99, spec: baseSpec })).toBeUndefined()
  })
})

describe('normaliseExplorerState', () => {
  it('keeps valid stored state including dark theme', () => {
    const stored = { ...fallback(), theme: 'dark', sql: 'SELECT a FROM ?' }
    expect(normaliseExplorerState(stored, fallback())).toEqual(stored)
  })

  it('falls back per field on corrupt input', () => {
    const out = normaliseExplorerState({ version: 2, spec: { kind: 'nope' }, sql: '  ', saved: [{ id: 'x' }], theme: 'neon' }, fallback())
    expect(out.spec).toEqual(baseSpec)
    expect(out.sql).toBe('SELECT * FROM ?')
    expect(out.saved).toEqual([])
    expect(out.theme).toBe('light')
  })
})

describe('local storage adapter', () => {
  it('round-trips state through a storage stub', () => {
    const backing = new Map<string, string>()
    const adapter = createLocalStorageExplorerAdapter({
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
    } as Storage)
    const state = { ...fallback(), theme: 'dark' as const }
    adapter.save('k', state)
    expect(adapter.load('k')).toEqual(state)
  })
})

describe('share hash', () => {
  it('round-trips spec and sql including unicode', () => {
    const sql = "SELECT * FROM ? WHERE label = 'Müller'"
    const hash = encodeShareHash(baseSpec, sql)
    expect(hash.startsWith('#s=')).toBe(true)
    expect(hash.slice('#s='.length)).not.toMatch(/[+/=]/)
    expect(decodeShareHash(hash)).toEqual({ spec: baseSpec, sql })
  })

  it('rejects garbage, wrong shapes and bad specs', () => {
    expect(decodeShareHash('')).toBeUndefined()
    expect(decodeShareHash('#s=!!!not-base64!!!')).toBeUndefined()
    expect(decodeShareHash(encodeShareHash({ kind: 'nope' } as unknown as ChartSpec, 'SELECT 1'))).toBeUndefined()
  })
})
