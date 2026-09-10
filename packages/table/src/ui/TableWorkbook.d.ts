import type { SheetTab } from "./TableSections";
export type TableWorkbookSheet<T> = SheetTab & Readonly<{
    state: T;
}>;
/**
 * Headless sheet collection. It owns sheet order and state, while React mounts
 * only the active Spreadsheet. The generic state can include data, selection,
 * query, widths, or any host-specific metadata.
 */
export declare class TableWorkbook<T> {
    #private;
    constructor(sheets: readonly TableWorkbookSheet<T>[], activeSheetId?: string);
    get activeSheetId(): string;
    get sheets(): readonly TableWorkbookSheet<T>[];
    get tabs(): readonly SheetTab[];
    get activeSheet(): TableWorkbookSheet<T>;
    select(sheetId: string): void;
    add(sheet: TableWorkbookSheet<T>, index?: number): void;
    rename(sheetId: string, label: string): void;
    move(sheetId: string, toIndex: number): void;
    remove(sheetId: string): void;
    update<State extends T>(sheetId: string, update: State | ((current: T) => State)): void;
}
