import type { SheetTab } from "./TableSections";

export type TableWorkbookSheet<T> = SheetTab & Readonly<{ state: T }>;

/**
 * Headless sheet collection. It owns sheet order and state, while React mounts
 * only the active Spreadsheet. The generic state can include data, selection,
 * query, widths, or any host-specific metadata.
 */
export class TableWorkbook<T> {
  #sheets: TableWorkbookSheet<T>[];
  #activeSheetId: string;

  constructor(sheets: readonly TableWorkbookSheet<T>[], activeSheetId = sheets[0]?.id) {
    if (sheets.length === 0) throw new Error("A table workbook requires at least one sheet");
    if (new Set(sheets.map((sheet) => sheet.id)).size !== sheets.length) throw new Error("Sheet ids must be unique");
    if (!sheets.some((sheet) => sheet.id === activeSheetId)) throw new Error(`Unknown active sheet: ${activeSheetId}`);
    this.#sheets = [...sheets];
    this.#activeSheetId = activeSheetId;
  }

  get activeSheetId(): string {
    return this.#activeSheetId;
  }

  get sheets(): readonly TableWorkbookSheet<T>[] {
    return this.#sheets;
  }

  get tabs(): readonly SheetTab[] {
    return this.#sheets.map(({ id, label, kind }) => ({ id, label, kind }));
  }

  get activeSheet(): TableWorkbookSheet<T> {
    const sheet = this.#sheets.find((candidate) => candidate.id === this.#activeSheetId);
    if (!sheet) throw new Error("No active sheet");
    return sheet;
  }

  select(sheetId: string): void {
    this.#require(sheetId);
    this.#activeSheetId = sheetId;
  }

  add(sheet: TableWorkbookSheet<T>, index = this.#sheets.length): void {
    if (this.#sheets.some((candidate) => candidate.id === sheet.id)) throw new Error(`Duplicate sheet id: ${sheet.id}`);
    const position = Math.max(0, Math.min(index, this.#sheets.length));
    this.#sheets.splice(position, 0, sheet);
    this.#activeSheetId = sheet.id;
  }

  rename(sheetId: string, label: string): void {
    const index = this.#require(sheetId);
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Sheet label cannot be empty");
    this.#sheets[index] = { ...this.#sheets[index], label: trimmed };
  }

  move(sheetId: string, toIndex: number): void {
    const fromIndex = this.#require(sheetId);
    const [sheet] = this.#sheets.splice(fromIndex, 1);
    this.#sheets.splice(Math.max(0, Math.min(toIndex, this.#sheets.length)), 0, sheet);
  }

  remove(sheetId: string): void {
    if (this.#sheets.length === 1) throw new Error("A table workbook must keep at least one sheet");
    const index = this.#require(sheetId);
    this.#sheets.splice(index, 1);
    if (this.#activeSheetId === sheetId) this.#activeSheetId = this.#sheets[Math.min(index, this.#sheets.length - 1)].id;
  }

  update<State extends T>(sheetId: string, update: State | ((current: T) => State)): void {
    const index = this.#require(sheetId);
    const current = this.#sheets[index];
    const state = typeof update === "function" ? (update as (current: T) => State)(current.state) : update;
    this.#sheets[index] = { ...current, state };
  }

  #require(sheetId: string): number {
    const index = this.#sheets.findIndex((sheet) => sheet.id === sheetId);
    if (index < 0) throw new Error(`Unknown sheet: ${sheetId}`);
    return index;
  }
}
