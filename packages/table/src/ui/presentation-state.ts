import { useEffect, useState, type SetStateAction } from "react";
import { createHttpAdapter, resolveTheme, useResolvedTheme, type ResolvedTheme, type ThemeMode } from "sheetbase-shared";
import type { ConditionalFormatRule } from "../grid/conditional-formatting";
import type { SpreadsheetFormatEntry } from "./Spreadsheet";
import { normaliseCellAnnotations, type CellAnnotation } from "./annotations";
import type { DatasetQuery } from "../data";

export type SurfaceObjectPlacement = "right" | "bottom";
export type SurfaceObjectLayout = Readonly<{
  id: string;
  kind: string;
  placement: SurfaceObjectPlacement;
  size: number;
  open: boolean;
  context?: Readonly<Record<string, string>>;
}>;

export type { ResolvedTheme, ThemeMode };

export type TablePresentationState = Readonly<{
  version: 3;
  theme: ThemeMode;
  conditionalFormats: readonly ConditionalFormatRule[];
  formats: readonly SpreadsheetFormatEntry[];
  objects: readonly SurfaceObjectLayout[];
  query: DatasetQuery;
  columns: readonly ColumnPresentation[];
  frozenColumns: number;
  views: readonly SavedTableView[];
  activeViewId?: string;
  annotations: readonly CellAnnotation[];
  /**
   * Row heights keyed by row index (`String(row)`), not by record id: unlike
   * columns — which persist by stable fieldId — grid rows have no stable
   * semantic identity at this layer (inserts/deletes shift indices), so the
   * index is the honest key. Absent (undefined) means automatic height.
   */
  rowHeights?: Readonly<Record<string, number>>;
}>;

export type ColumnPresentation = Readonly<{ fieldId: string; width?: number; hidden?: boolean }>;
export type SavedTableView = Readonly<{
  id: string;
  name: string;
  query: DatasetQuery;
  columns: readonly ColumnPresentation[];
  frozenColumns: number;
  theme: ThemeMode;
  conditionalFormats: readonly ConditionalFormatRule[];
  formats: readonly SpreadsheetFormatEntry[];
  objects: readonly SurfaceObjectLayout[];
}>;

export interface TablePresentationAdapter {
  /** Return a promise when the state must be fetched from a server. */
  load(key: string): unknown | PromiseLike<unknown>;
  save(key: string, state: TablePresentationState): void;
}

/** Bump this when the stored schema changes and register a migration for the previous version. */
export const CURRENT_PRESENTATION_VERSION = 3;

export type PresentationMigration = Readonly<{
  from: number;
  to: number;
  migrate(value: Record<string, unknown>): Record<string, unknown>;
}>;

const migrations: PresentationMigration[] = [];
const migrationByVersion = new Map<number, PresentationMigration>();

/** v1 → v2: annotations join the persisted overlay (empty for existing states). */
registerPresentationMigration({
  from: 1,
  to: 2,
  migrate: (value) => ({ ...value, annotations: [] }),
});

/**
 * v2 → v3: annotations gain optional `recordId`/`fieldId` (bound-grid
 * identity). Stored entries were address-pinned when written, and stay
 * address-pinned — no transform, just the version bump.
 */
registerPresentationMigration({
  from: 2,
  to: 3,
  migrate: (value) => ({ ...value }),
});

/** Register a step that upgrades stored state from one schema version to the next. */
export function registerPresentationMigration(migration: PresentationMigration): void {
  migrations.push(migration);
  if (!migrationByVersion.has(migration.from)) migrationByVersion.set(migration.from, migration);
}

/**
 * Replay registered migrations over stored state and guard against futures:
 * state written by a NEWER version of the library returns undefined so the
 * caller falls back instead of misreading unknown fields.
 */
export function migratePresentationState(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  let current: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  let version = typeof current.version === "number" ? current.version : CURRENT_PRESENTATION_VERSION;
  if (version > CURRENT_PRESENTATION_VERSION) return undefined;
  while (version < CURRENT_PRESENTATION_VERSION) {
    const migration = migrationByVersion.get(version);
    if (!migration) break;
    current = { ...migration.migrate(current), version: migration.to };
    version = migration.to;
  }
  return current;
}

export function normalisePresentationState(value: unknown, fallback: TablePresentationState): TablePresentationState {
  const migrated = migratePresentationState(value);
  if (!migrated || typeof migrated !== "object") return fallback;
  const stored = migrated as Partial<TablePresentationState> & { rules?: readonly ConditionalFormatRule[]; panelField?: string };
  const objects = Array.isArray(stored.objects) ? stored.objects : fallback.objects.map((object) => object.id === "conditional-formatting" || object.kind === "inspector" ? {
    ...object,
    open: typeof stored.panelField === "string",
    context: { ...object.context, ...(stored.panelField ? { fieldId: stored.panelField } : {}) },
  } : object);
  return {
    version: 3,
    theme: stored.theme === "dark" || stored.theme === "light" || stored.theme === "system" ? stored.theme : fallback.theme,
    conditionalFormats: Array.isArray(stored.conditionalFormats) ? stored.conditionalFormats : Array.isArray(stored.rules) ? stored.rules : fallback.conditionalFormats,
    formats: Array.isArray(stored.formats) ? stored.formats : fallback.formats,
    objects,
    query: stored.query ?? fallback.query,
    columns: Array.isArray(stored.columns) ? stored.columns : fallback.columns,
    frozenColumns: typeof stored.frozenColumns === "number" ? stored.frozenColumns : fallback.frozenColumns,
    views: Array.isArray(stored.views) ? stored.views : fallback.views,
    activeViewId: stored.activeViewId,
    annotations: normaliseCellAnnotations(stored.annotations),
    rowHeights: normaliseRowHeights(stored.rowHeights, fallback.rowHeights),
  };
}

/** Row-height map: absent stays absent (auto); stored entries keep finite positive heights only. */
function normaliseRowHeights(
  value: Readonly<Record<string, number>> | undefined,
  fallback: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const next: Record<string, number> = {};
  for (const [key, height] of Object.entries(value)) {
    if (typeof height === "number" && Number.isFinite(height) && height > 0) next[key] = height;
  }
  return next;
}

export function createLocalStoragePresentationAdapter(storage?: Storage): TablePresentationAdapter {
  const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  return {
    load(key) {
      if (!target) return undefined;
      try { const value = target.getItem(key); return value ? JSON.parse(value) : undefined; } catch { return undefined; }
    },
    save(key, state) {
      if (!target) return;
      try { target.setItem(key, JSON.stringify(state)); } catch { /* Persistence is optional. */ }
    },
  };
}

export type PresentationFetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Adapter that persists presentation state through a host-provided HTTP endpoint. */
export function createHttpPresentationAdapter(baseUrl: string, fetcher: PresentationFetchLike = globalThis.fetch.bind(globalThis)): TablePresentationAdapter {
  return createHttpAdapter<TablePresentationState>(baseUrl, fetcher, "Presentation");
}

export function useTablePresentationState(
  key: string,
  fallback: TablePresentationState,
  adapter: TablePresentationAdapter,
): readonly [TablePresentationState, (next: SetStateAction<TablePresentationState>) => void] {
  const [loaded] = useState(() => adapter.load(key));
  const [state, setState] = useState(() => normalisePresentationState(isThenable(loaded) ? fallback : loaded, fallback));
  useEffect(() => {
    if (!isThenable(loaded)) return;
    let active = true;
    Promise.resolve(loaded).then(
      (value) => { if (active) setState(normalisePresentationState(value, fallback)); },
      (error) => { if (active) console.error("Presentation load failed", error); },
    );
    return () => { active = false; };
  }, [adapter, fallback, key, loaded]);
  useEffect(() => {
    const idle = typeof window.requestIdleCallback === "function";
    const schedule: number = idle
      ? window.requestIdleCallback(() => adapter.save(key, state), { timeout: 500 })
      : Number(globalThis.setTimeout(() => adapter.save(key, state), 0));
    return () => {
      if (idle) window.cancelIdleCallback(schedule);
      else globalThis.clearTimeout(schedule);
    };
  }, [adapter, key, state]);
  return [state, setState] as const;
}

export { resolveTheme, useResolvedTheme };

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === "function";
}
