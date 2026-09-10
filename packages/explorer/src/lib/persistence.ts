import { useEffect } from 'react'
import type { ChartSpec, SavedExploration } from './types'

/**
 * Versioned persistence boundary for the explorer session.
 *
 * Borrowed from sheetbase-table's `TablePresentationAdapter` concept:
 * versioned serialisable state, registered migrations, a localStorage
 * adapter for the default host, an HTTP adapter for database-backed hosts,
 * and idle-scheduled saves so typing never blocks on storage.
 */

export const EXPLORER_STORAGE_KEY = 'sheetbase-explorer:session:v1'
export const CURRENT_EXPLORATION_VERSION = 2

export interface PersistedExplorerState {
  version: typeof CURRENT_EXPLORATION_VERSION
  theme: 'light' | 'dark'
  spec: ChartSpec
  sql: string
  saved: SavedExploration[]
  updatedAt: string
}

export interface ExplorerPersistenceAdapter {
  /** Return a promise when the state must be fetched from a server. */
  load(key: string): unknown | PromiseLike<unknown> | undefined
  save(key: string, state: PersistedExplorerState): void
}

export interface ExplorerMigration {
  from: number
  to: number
  migrate(value: Record<string, unknown>): Record<string, unknown>
}

const migrations: ExplorerMigration[] = []

export function registerExplorerMigration(migration: ExplorerMigration): void {
  migrations.push(migration)
}

/** v1 → v2: theme joins the persisted session (light for existing states). */
registerExplorerMigration({
  from: 1,
  to: 2,
  migrate: (value) => ({ ...value, theme: 'light' }),
})

export function migrateExplorerState(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  let current: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  let version = typeof current.version === 'number' ? current.version : CURRENT_EXPLORATION_VERSION
  // State written by a newer explorer falls back instead of misreading unknown fields.
  if (version > CURRENT_EXPLORATION_VERSION) return undefined
  const migrationBySource = new Map(migrations.map((migration) => [migration.from, migration] as const))
  while (version < CURRENT_EXPLORATION_VERSION) {
    const migration = migrationBySource.get(version)
    if (!migration) break
    current = { ...migration.migrate(current), version: migration.to }
    version = migration.to
  }
  return current
}

const SPEC_KINDS: Record<string, true> = { scatter: true, line: true, bar: true, 'horizontal-bar': true, area: true, histogram: true, box: true, lollipop: true, violin: true, waterfall: true, heatmap: true, pie: true, donut: true }

export function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  const kind: unknown = value.kind
  return typeof kind === 'string' && SPEC_KINDS[kind] === true
}

function isSavedExploration(value: unknown): value is SavedExploration {
  const candidate = value as SavedExploration | undefined
  return !!candidate && typeof candidate.id === 'string' && isChartSpec(candidate.spec) && typeof candidate.sql === 'string'
}

export function normaliseExplorerState(value: unknown, fallback: PersistedExplorerState): PersistedExplorerState {
  const migrated = migrateExplorerState(value)
  if (!migrated || typeof migrated !== 'object') return fallback
  const stored = migrated as Partial<PersistedExplorerState>
  return {
    version: CURRENT_EXPLORATION_VERSION,
    theme: stored.theme === 'dark' ? 'dark' : stored.theme === 'light' ? 'light' : fallback.theme,
    spec: isChartSpec(stored.spec) ? stored.spec : fallback.spec,
    sql: typeof stored.sql === 'string' && stored.sql.trim() ? stored.sql : fallback.sql,
    saved: Array.isArray(stored.saved) ? stored.saved.filter(isSavedExploration) : fallback.saved,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : fallback.updatedAt,
  }
}

export function createLocalStorageExplorerAdapter(storage?: Storage): ExplorerPersistenceAdapter {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  return {
    load(key) {
      if (!target) return undefined
      try {
        const value = target.getItem(key)
        return value ? (JSON.parse(value) as unknown) : undefined
      } catch {
        return undefined
      }
    },
    save(key, state) {
      if (!target) return
      try {
        target.setItem(key, JSON.stringify(state))
      } catch {
        // Persistence is optional; a full quota must never break charting.
      }
    },
  }
}

export type PersistenceFetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

/** Database-backed host adapter: `GET {baseUrl}?key=` (404 = none saved), `PUT {baseUrl}` with `{ key, state }`. */
export function createHttpExplorerAdapter(baseUrl: string, fetcher: PersistenceFetchLike = globalThis.fetch.bind(globalThis)): ExplorerPersistenceAdapter {
  return {
    async load(key) {
      const response = await fetcher(`${baseUrl}?key=${encodeURIComponent(key)}`)
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`Exploration load failed (${response.status})`)
      return (await response.json()) as unknown
    },
    async save(key, state) {
      const response = await fetcher(baseUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, state }),
      })
      if (!response.ok) throw new Error(`Exploration save failed (${response.status})`)
    },
  }
}

/** Shared default host adapter so lazy state initialisers stay above hooks. */
export const defaultExplorerAdapter = createLocalStorageExplorerAdapter()

export function loadInitialExplorerState(fallback: PersistedExplorerState, adapter: ExplorerPersistenceAdapter = defaultExplorerAdapter): PersistedExplorerState {
  try {
    const loaded = adapter.load(EXPLORER_STORAGE_KEY)
    // Async hosts resolve later; the caller applies them via normaliseExplorerState when they land.
    if (loaded && typeof (loaded as PromiseLike<unknown>).then === 'function') return fallback
    return normaliseExplorerState(loaded, fallback)
  } catch {
    return fallback
  }
}

/** Idle-scheduled save mirroring `useTablePresentationState`: never blocks interaction. */
export function useIdleExplorerSave(key: string, state: PersistedExplorerState, adapter: ExplorerPersistenceAdapter): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const save = () => {
      try {
        adapter.save(key, state)
      } catch (error) {
        console.error('Exploration save failed', error)
      }
    }

    if (typeof window.requestIdleCallback === 'function') {
      const schedule = window.requestIdleCallback(save, { timeout: 500 })
      return () => window.cancelIdleCallback(schedule)
    }
    const timer = globalThis.setTimeout(save, 0)
    return () => globalThis.clearTimeout(timer)
  }, [adapter, key, state])
}

const SHARE_PREFIX = '#s='

/** Encodes the shareable slice (spec + sql) as a URL hash for copy-link. */
export function encodeShareHash(spec: ChartSpec, sql: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ spec, sql }))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `${SHARE_PREFIX}${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`
}

/** A shared link wins over stored session state; garbage returns undefined. */
export function decodeShareHash(hash: string): { spec: ChartSpec; sql: string } | undefined {
  if (!hash.startsWith(SHARE_PREFIX)) return undefined
  try {
    const binary = atob(hash.slice(SHARE_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object') return undefined
    const { spec, sql } = parsed as { spec?: unknown; sql?: unknown }
    if (!isChartSpec(spec) || typeof sql !== 'string') return undefined
    return { spec, sql }
  } catch {
    return undefined
  }
}
