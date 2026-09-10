import { type RefObject } from "react";
import type { RecordFieldWrite } from "../data/adapter";
import { type RevisionConflict } from "../data/conflicts";
export type ConflictPanelEntry = Readonly<{
    conflict: RevisionConflict;
    write: RecordFieldWrite;
    currentRevision: string;
}>;
export type ConflictPanelProps = Readonly<{
    conflicts: readonly ConflictPanelEntry[];
    fieldLabels?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
    trigger?: RefObject<HTMLElement | null>;
    onKeepMine(entry: ConflictPanelEntry, index: number): void;
    onTakeServer(entry: ConflictPanelEntry, index: number): void;
    onKeepAll(): void;
    onTakeAll(): void;
    onClose(): void;
}>;
/** Lists one row per revision conflict with per-row and resolve-all actions. Renders in a portal. */
export declare function ConflictPanel({ conflicts, fieldLabels, trigger, onKeepMine, onTakeServer, onKeepAll, onTakeAll, onClose, }: ConflictPanelProps): import("react").ReactPortal | null;
