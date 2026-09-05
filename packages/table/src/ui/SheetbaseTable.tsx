import { useCallback, useRef, useState } from "react";
import { Spreadsheet, type SpreadsheetHandle, type SpreadsheetProps, type SpreadsheetSelection } from "./Spreadsheet";
import { FormulaBar, SheetBar, TableLayout, minimalTableSections, type SheetTab, type TableSectionConfig } from "./TableSections";

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

const noSheets: readonly SheetTab[] = [];

/** Public single-renderer table composition. Sheet ownership remains with the caller. */
export function SheetbaseTable({ spreadsheet, sections, sheets = noSheets, activeSheetId = sheets[0]?.id ?? "", onSheetSelect, onAddSheet, onSheetRename, onSheetDelete, onSheetMove, readOnly = false }: SheetbaseTableProps) {
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "A1", range: "A1", input: "" });
  const [formula, setFormula] = useState("");
  const onSelectionChange = useCallback((next: SpreadsheetSelection) => {
    setSelection(next);
    setFormula(next.input);
    spreadsheet.onSelectionChange?.(next);
  }, [spreadsheet]);
  const focusTable = () => tableRef.current?.focus();

  return <TableLayout
    sections={{ ...minimalTableSections, ...sections }}
    formulaBar={<FormulaBar
      address={selection.range}
      value={formula}
      readOnly={readOnly}
      onChange={(value) => { if (readOnly) return; setFormula(value); tableRef.current?.editActiveInput(value); }}
      onCommit={() => { if (!readOnly) tableRef.current?.commitEdit(); focusTable(); }}
      onCancel={() => { tableRef.current?.cancelEdit(); setFormula(selection.input); focusTable(); }}
      error={selection.error}
    />}
    table={<Spreadsheet {...spreadsheet} readOnly={readOnly || spreadsheet.readOnly} ref={tableRef} onSelectionChange={onSelectionChange} onEditChange={setFormula} />}
    sheetBar={sheets.length > 0 ? <SheetBar sheets={sheets} activeSheetId={activeSheetId} onSelect={onSheetSelect ?? (() => undefined)} onAdd={readOnly ? undefined : onAddSheet} onRename={readOnly ? undefined : onSheetRename} onDelete={readOnly ? undefined : onSheetDelete} onMove={readOnly ? undefined : onSheetMove} /> : undefined}
  />;
}
