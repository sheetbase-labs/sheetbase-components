import type { CommitResult, DataAdapter, RecordFieldWrite } from "./adapter";

export type RevisionConflict = Readonly<{ write: RecordFieldWrite; serverValue?: string; reason: string }>;

export class RevisionConflictError extends Error {
  constructor(readonly currentRevision: string, readonly conflicts: readonly RevisionConflict[]) {
    super(`Revision conflict at ${currentRevision}`);
    this.name = "RevisionConflictError";
  }
}

export type CoordinatedCommit =
  | Readonly<{ status: "committed"; result: CommitResult }>
  | Readonly<{ status: "conflict"; baseRevision?: string; currentRevision: string; conflicts: readonly RevisionConflict[]; writes: readonly RecordFieldWrite[] }>;

export type ConflictRow = Readonly<{
  recordId: string;
  fieldId: string;
  fieldLabel: string;
  /** The local value the commit attempted to write. */
  mine?: string;
  /** The authoritative server value. */
  server?: string;
  reason: string;
}>;

export function conflictKey(conflict: RevisionConflict): string {
  return JSON.stringify([conflict.write.recordId, conflict.write.fieldId]);
}

export function conflictRows(
  conflicts: readonly RevisionConflict[],
  fieldLabels?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): readonly ConflictRow[] {
  const labelFor = (fieldId: string): string => {
    if (!fieldLabels) return fieldId;
    if (fieldLabels instanceof Map) return fieldLabels.get(fieldId) ?? fieldId;
    return (fieldLabels as Readonly<Record<string, string>>)[fieldId] ?? fieldId;
  };
  return conflicts.map((conflict) => ({
    recordId: conflict.write.recordId,
    fieldId: conflict.write.fieldId,
    fieldLabel: labelFor(conflict.write.fieldId),
    mine: conflict.write.after,
    server: conflict.serverValue,
    reason: conflict.reason,
  }));
}

export class RevisionedCommitCoordinator {
  #revision?: string;
  constructor(readonly adapter: DataAdapter, initialRevision?: string) { this.#revision = initialRevision; }
  get revision(): string | undefined { return this.#revision; }
  async commit(writes: readonly RecordFieldWrite[]): Promise<CoordinatedCommit> {
    const baseRevision = this.#revision;
    try {
      const result = await this.adapter.commit(writes, baseRevision);
      this.#revision = result.revision;
      return { status: "committed", result };
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      return { status: "conflict", baseRevision, currentRevision: error.currentRevision, conflicts: error.conflicts, writes };
    }
  }
  acceptRevision(revision: string): void { this.#revision = revision; }
}
