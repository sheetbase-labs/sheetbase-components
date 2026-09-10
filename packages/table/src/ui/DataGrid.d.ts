export interface DataGridColumn {
    id: string;
    label: string;
    /** Optional type hint shown next to the label (e.g. "string", "number"). */
    kind?: string;
}
export interface DataGridProps {
    columns: readonly DataGridColumn[];
    rows: readonly Record<string, unknown>[];
    /** Stable row identity; defaults to the row index. */
    rowKey?(row: Record<string, unknown>, index: number): string | number;
    /** Leading row-number column. Default true. */
    rownum?: boolean;
    /** Selected row index. */
    selectedRow?: number;
    onSelectRow?(index: number): void;
    /** Click-to-sort headers. Default false. */
    sortable?: boolean;
    emptyMessage?: string;
    className?: string;
}
/**
 * Read-only tabular view for previews and inspectors. Fixed-height, windowed
 * rows with sticky headers, sharing the `.sb-table` styling. This is the table
 * other components should render instead of rolling their own `<table>`.
 */
export declare function DataGrid({ columns, rows, rowKey, rownum, selectedRow, onSelectRow, sortable, emptyMessage, className, }: DataGridProps): import("react").JSX.Element;
