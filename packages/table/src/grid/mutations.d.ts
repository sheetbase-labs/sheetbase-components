import { RangeStore, Worksheet } from "../engine";
import type { CellFormat } from "../engine";
import { CellStore } from "./cell-store";
export type CellChange = Readonly<{
    address: string;
    before?: string;
    after?: string;
}>;
export type ColumnWidthChange = Readonly<{
    column: number;
    before: number;
    after: number;
}>;
export type GridMutation = Readonly<{
    label: string;
    cells: readonly CellChange[];
    formats?: Readonly<{
        before: RangeStore<CellFormat>;
        after: RangeStore<CellFormat>;
    }>;
    columnWidths: readonly ColumnWidthChange[];
}>;
export declare function cellMutation(label: string, before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, affectedAddresses?: Iterable<string>): GridMutation;
export declare function cellChangesMutation(label: string, cells: readonly CellChange[]): GridMutation;
export declare function formatMutation(label: string, before: RangeStore<CellFormat>, after: RangeStore<CellFormat>): GridMutation;
export declare function columnWidthMutation(change: ColumnWidthChange): GridMutation;
export declare function isEmptyMutation(mutation: GridMutation): boolean;
/** A grid mutation stamped for audit/provenance sinks. */
export type AuditedMutation = GridMutation & Readonly<{
    at: string;
    revision?: string;
}>;
/** Receives every committed, undone, redone, or conflict-resolved mutation. Never blocks the commit. */
export type MutationAuditSink = (mutation: AuditedMutation) => void;
export declare function auditedMutation(mutation: GridMutation, revision?: string): AuditedMutation;
/** Invokes the audit sink synchronously; sink errors are swallowed so commits never fail. */
export declare function emitMutationAudit(sink: MutationAuditSink | undefined, mutation: GridMutation, revision?: string): void;
export declare function applyCellMutation(data: ReadonlyMap<string, string>, mutation: GridMutation, direction?: "forward" | "backward"): CellStore;
export declare function applyWorksheetMutation(worksheet: Worksheet, mutation: GridMutation, direction?: "forward" | "backward"): void;
export declare function applyColumnWidthMutation(widths: readonly number[], mutation: GridMutation, direction?: "forward" | "backward"): number[];
export declare function mutationFormat(current: RangeStore<CellFormat>, mutation: GridMutation, direction?: "forward" | "backward"): RangeStore<CellFormat>;
