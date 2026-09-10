import type { DatasetQuery } from "../data";
import type { ColumnPresentation } from "./presentation-state";
import { type TableControlsField } from "./filter-conditions";
export type TableControlsProps = Readonly<{
    fields: readonly TableControlsField[];
    query: DatasetQuery;
    onQueryChange(query: DatasetQuery): void;
    columns: readonly ColumnPresentation[];
    onColumnsChange(columns: readonly ColumnPresentation[]): void;
    onFrozenColumnsChange?(frozenColumns: number): void;
    theme?: "light" | "dark";
}>;
/**
 * Controlled Filters and Columns toolbar controls, rendered through portal popovers
 * so table overflow clipping cannot hide them. Keyboard contract: Escape closes and
 * restores focus to the trigger, Tab wraps inside the popover, and focus leaving the
 * popover closes it.
 */
export declare const TableControls: import("react").NamedExoticComponent<Readonly<{
    fields: readonly TableControlsField[];
    query: DatasetQuery;
    onQueryChange(query: DatasetQuery): void;
    columns: readonly ColumnPresentation[];
    onColumnsChange(columns: readonly ColumnPresentation[]): void;
    onFrozenColumnsChange?(frozenColumns: number): void;
    theme?: "light" | "dark";
}>>;
