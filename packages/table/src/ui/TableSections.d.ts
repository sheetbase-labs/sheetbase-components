import { type ReactNode } from "react";
export type TableSectionConfig = Readonly<{
    menuBar: boolean;
    toolbar: boolean;
    formulaBar: boolean;
    sidebar: boolean;
    statusBar: boolean;
    sheetBar: boolean;
}>;
export declare const minimalTableSections: TableSectionConfig;
export type FormulaBarProps = Readonly<{
    address: string;
    value: string;
    onChange(value: string): void;
    onCommit(): void;
    onCancel(): void;
    error?: string;
    readOnly?: boolean;
}>;
export declare function FormulaBar({ address, value, onChange, onCommit, onCancel, error, readOnly }: FormulaBarProps): import("react").JSX.Element;
export type SheetTab = Readonly<{
    id: string;
    label: string;
    kind?: "sheet" | "dataset";
}>;
export type SheetBarProps = Readonly<{
    sheets: readonly SheetTab[];
    activeSheetId: string;
    onSelect(sheetId: string): void;
    onAdd?(): void;
    onRename?(sheetId: string, label: string): void;
    onDelete?(sheetId: string): void;
    onMove?(sheetId: string, index: number): void;
}>;
export declare function SheetBar({ sheets, activeSheetId, onSelect, onAdd, onRename, onDelete, onMove }: SheetBarProps): import("react").JSX.Element;
type TableLayoutProps = Readonly<{
    sections?: Partial<TableSectionConfig>;
    menuBar?: ReactNode;
    toolbar?: ReactNode;
    formulaBar?: ReactNode;
    sidebar?: ReactNode;
    statusBar?: ReactNode;
    table: ReactNode;
    sheetBar?: ReactNode;
    /** Resolved light/dark theme owned by the table itself; system resolution stays in presentation state. */
    theme?: "light" | "dark";
}>;
/** Configurable composition boundary; the spreadsheet engine remains unchanged. */
export declare function TableLayout({ sections, menuBar, toolbar, formulaBar, sidebar, statusBar, table, sheetBar, theme }: TableLayoutProps): import("react").JSX.Element;
export {};
