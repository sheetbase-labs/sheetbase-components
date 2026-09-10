import { type SetStateAction } from "react";
import type { ConditionalFormatRule } from "../grid/conditional-formatting";
import type { SpreadsheetFormatEntry } from "./Spreadsheet";
import { type CellAnnotation } from "./annotations";
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
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type TablePresentationState = Readonly<{
    version: 2;
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
export type ColumnPresentation = Readonly<{
    fieldId: string;
    width?: number;
    hidden?: boolean;
}>;
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
export declare const CURRENT_PRESENTATION_VERSION = 2;
export type PresentationMigration = Readonly<{
    from: number;
    to: number;
    migrate(value: Record<string, unknown>): Record<string, unknown>;
}>;
/** Register a step that upgrades stored state from one schema version to the next. */
export declare function registerPresentationMigration(migration: PresentationMigration): void;
/**
 * Replay registered migrations over stored state and guard against futures:
 * state written by a NEWER version of the library returns undefined so the
 * caller falls back instead of misreading unknown fields.
 */
export declare function migratePresentationState(value: unknown): unknown;
export declare function normalisePresentationState(value: unknown, fallback: TablePresentationState): TablePresentationState;
export declare function createLocalStoragePresentationAdapter(storage?: Storage): TablePresentationAdapter;
export type PresentationFetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
/** Adapter that persists presentation state through a host-provided HTTP endpoint. */
export declare function createHttpPresentationAdapter(baseUrl: string, fetcher?: PresentationFetchLike): TablePresentationAdapter;
export declare function useTablePresentationState(key: string, fallback: TablePresentationState, adapter: TablePresentationAdapter): readonly [TablePresentationState, (next: SetStateAction<TablePresentationState>) => void];
/** Resolve a stored mode to a concrete theme; system reads the OS preference live. */
export declare function resolveTheme(mode: ThemeMode): ResolvedTheme;
/** Resolved theme that tracks the OS preference while the mode is system. */
export declare function useResolvedTheme(mode: ThemeMode): ResolvedTheme;
