import { createContext, useContext, type ReactNode } from "react";
import type { SheetbaseField } from "./fields";
import type { DatasetQuery } from "./query";

/**
 * Shared, host-owned state that several components read from and write to,
 * so they can interact without the host wiring every pair directly.
 *
 * The host owns the state (React state / store) and passes it in; components
 * read slices via the hooks and report edits through their existing callbacks.
 */
export interface WorkspaceState {
  /** Active dataset fields (e.g. the selected schema model's columns). */
  fields: readonly SheetbaseField[];
  /** Active dataset rows. */
  rows: readonly Record<string, unknown>[];
  /** Compiled query — filters/sort — shared by search, table and rules. */
  query: DatasetQuery;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceState; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Full workspace, or null when used outside a provider. */
export function useWorkspace(): WorkspaceState | null {
  return useContext(WorkspaceContext);
}

export function useWorkspaceQuery(fallback: DatasetQuery = {}): DatasetQuery {
  return useContext(WorkspaceContext)?.query ?? fallback;
}

export function useWorkspaceFields(fallback: readonly SheetbaseField[] = []): readonly SheetbaseField[] {
  return useContext(WorkspaceContext)?.fields ?? fallback;
}

export function useWorkspaceRows(fallback: readonly Record<string, unknown>[] = []): readonly Record<string, unknown>[] {
  return useContext(WorkspaceContext)?.rows ?? fallback;
}
