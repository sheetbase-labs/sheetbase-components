import { useState, type ReactNode } from "react";
import { cycleAbsoluteReference } from "../grid/model";
import { FormulaTokens } from "./FormulaTokens";

export type TableSectionConfig = Readonly<{
  menuBar: boolean;
  toolbar: boolean;
  formulaBar: boolean;
  sidebar: boolean;
  statusBar: boolean;
  sheetBar: boolean;
}>;

export const minimalTableSections: TableSectionConfig = {
  menuBar: false,
  toolbar: false,
  formulaBar: true,
  sidebar: false,
  statusBar: false,
  sheetBar: true,
};

export type FormulaBarProps = Readonly<{
  address: string;
  value: string;
  onChange(value: string): void;
  onCommit(): void;
  onCancel(): void;
  error?: string;
  readOnly?: boolean;
}>;

export function FormulaBar({ address, value, onChange, onCommit, onCancel, error, readOnly = false }: FormulaBarProps) {
  const [showError, setShowError] = useState(false);
  return <div className="formula-bar" role="toolbar" aria-label="Formula bar">
    <span className="address">{address}</span>
    <span className="fx" aria-hidden="true">ƒx</span>
    <span className="formula-input-wrap">
      {value.startsWith("=") && <FormulaTokens value={value} />}
      <input
        className={value.startsWith("=") ? "tokenised-input" : undefined}
        data-formula-bar
        aria-label="Formula"
        value={value}
        readOnly={readOnly || undefined}
        aria-readonly={readOnly || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "F4" && value.startsWith("=")) {
            event.preventDefault();
            onChange(cycleAbsoluteReference(value));
          }
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") onCancel();
        }}
      />
    </span>
    {error && <button className="formula-error" aria-label="Explain formula error" aria-expanded={showError} onClick={() => setShowError((visible) => !visible)}>!</button>}
    {error && showError && <div className="formula-error-popover" role="status" tabIndex={-1} autoFocus onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setShowError(false); } }}>{error}</div>}
  </div>;
}

export type SheetTab = Readonly<{ id: string; label: string; kind?: "sheet" | "dataset" }>;
export type SheetBarProps = Readonly<{
  sheets: readonly SheetTab[];
  activeSheetId: string;
  onSelect(sheetId: string): void;
  onAdd?(): void;
  onRename?(sheetId: string, label: string): void;
  onDelete?(sheetId: string): void;
  onMove?(sheetId: string, index: number): void;
}>;

export function SheetBar({ sheets, activeSheetId, onSelect, onAdd, onRename, onDelete, onMove }: SheetBarProps) {
  const [menuSheetId, setMenuSheetId] = useState<string>();
  const menuIndex = sheets.findIndex((sheet) => sheet.id === menuSheetId);
  return <footer className="sheet-bar" aria-label="Sheets">
    {onAdd && <button className="sheet-action" aria-label="Add sheet" onClick={onAdd}>＋</button>}
    <div className="sheet-tabs" role="tablist">
      {sheets.map((sheet) => <button
        role="tab"
        aria-selected={sheet.id === activeSheetId}
        className={sheet.id === activeSheetId ? "sheet-tab active" : "sheet-tab"}
        key={sheet.id}
        onClick={() => onSelect(sheet.id)}
        onDoubleClick={() => {
          if (!onRename) return;
          const label = window.prompt("Rename sheet", sheet.label)?.trim();
          if (label) onRename(sheet.id, label);
        }}
        onContextMenu={(event) => { event.preventDefault(); setMenuSheetId(sheet.id); }}
      >{sheet.kind === "dataset" ? "◆ " : ""}{sheet.label}</button>)}
    </div>
    {menuSheetId && <div className="sheet-menu" role="menu">
      <button disabled={!onRename} onClick={() => { const sheet = sheets[menuIndex]; const label = window.prompt("Rename sheet", sheet.label)?.trim(); if (label) onRename?.(sheet.id, label); setMenuSheetId(undefined); }}>Rename</button>
      <button disabled={menuIndex <= 0 || !onMove} onClick={() => { onMove?.(menuSheetId, menuIndex - 1); setMenuSheetId(undefined); }}>Move left</button>
      <button disabled={menuIndex < 0 || menuIndex >= sheets.length - 1 || !onMove} onClick={() => { onMove?.(menuSheetId, menuIndex + 1); setMenuSheetId(undefined); }}>Move right</button>
      <button disabled={sheets.length === 1 || !onDelete} onClick={() => { onDelete?.(menuSheetId); setMenuSheetId(undefined); }}>Delete</button>
    </div>}
  </footer>;
}

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
export function TableLayout({ sections, menuBar, toolbar, formulaBar, sidebar, statusBar, table, sheetBar, theme = "light" }: TableLayoutProps) {
  const enabled = { ...minimalTableSections, ...sections };
  return <section className="sheetbase-scope table-layout" data-theme={theme} aria-label="Sheetbase table">
    <div className="table-layout-top">
      {enabled.menuBar && menuBar}
      {enabled.toolbar && toolbar}
      {enabled.formulaBar && formulaBar}
    </div>
    <div className={enabled.sidebar ? "table-layout-content with-sidebar" : "table-layout-content"}>
      {enabled.sidebar && sidebar}
      <div className="table-layout-grid">
        {enabled.statusBar && statusBar}
        {table}
      </div>
    </div>
    {enabled.sheetBar && sheetBar}
  </section>;
}
