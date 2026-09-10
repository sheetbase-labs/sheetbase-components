import { type SpreadsheetProps } from "./Spreadsheet";
import { type SheetTab, type TableSectionConfig } from "./TableSections";
export type SheetbaseTableProps = Readonly<{
    spreadsheet: SpreadsheetProps;
    sections?: Partial<TableSectionConfig>;
    sheets?: readonly SheetTab[];
    activeSheetId?: string;
    onSheetSelect?(sheetId: string): void;
    onAddSheet?(): void;
    onSheetRename?(sheetId: string, label: string): void;
    onSheetDelete?(sheetId: string): void;
    onSheetMove?(sheetId: string, index: number): void;
    /** Blocks cell/structure/sheet mutations; selection, copy, sorting and filtering stay live. */
    readOnly?: boolean;
}>;
/** Public single-renderer table composition. Sheet ownership remains with the caller. */
export declare function SheetbaseTable({ spreadsheet, sections, sheets, activeSheetId, onSheetSelect, onAddSheet, onSheetRename, onSheetDelete, onSheetMove, readOnly }: SheetbaseTableProps): import("react").JSX.Element;
