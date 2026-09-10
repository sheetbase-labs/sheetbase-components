import type { CommitResult, DataAdapter, RecordFieldWrite } from "./adapter";
export type RevisionConflict = Readonly<{
    write: RecordFieldWrite;
    serverValue?: string;
    reason: string;
}>;
export declare class RevisionConflictError extends Error {
    readonly currentRevision: string;
    readonly conflicts: readonly RevisionConflict[];
    constructor(currentRevision: string, conflicts: readonly RevisionConflict[]);
}
export type CoordinatedCommit = Readonly<{
    status: "committed";
    result: CommitResult;
}> | Readonly<{
    status: "conflict";
    baseRevision?: string;
    currentRevision: string;
    conflicts: readonly RevisionConflict[];
    writes: readonly RecordFieldWrite[];
}>;
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
export declare function conflictKey(conflict: RevisionConflict): string;
export declare function conflictRows(conflicts: readonly RevisionConflict[], fieldLabels?: ReadonlyMap<string, string> | Readonly<Record<string, string>>): readonly ConflictRow[];
export declare class RevisionedCommitCoordinator {
    #private;
    readonly adapter: DataAdapter;
    constructor(adapter: DataAdapter, initialRevision?: string);
    get revision(): string | undefined;
    commit(writes: readonly RecordFieldWrite[]): Promise<CoordinatedCommit>;
    acceptRevision(revision: string): void;
}
