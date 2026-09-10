import { Worksheet } from "../engine/workbook";
import type { CellAddress } from "../engine/types";
export type GridPoint = Readonly<{
    row: number;
    column: number;
}>;
export type GridSelection = Readonly<{
    anchor: GridPoint;
    focus: GridPoint;
}>;
export type GridSnapshot = ReadonlyMap<string, string>;
export type FormulaSuggestion = Readonly<{
    label: string;
    detail: string;
    replacement: string;
    tokenStart: number;
    kind: "function" | "field" | "region";
    previewRange?: string;
}>;
export type FormulaRegion = Readonly<{
    label: string;
    reference?: string;
    detail?: string;
}>;
export declare function cellKey(point: GridPoint): string;
export declare function normaliseSelection(selection: GridSelection): {
    top: number;
    bottom: number;
    left: number;
    right: number;
};
export declare function moveSelection(selection: GridSelection, delta: GridPoint, rowCount: number, columnCount: number, extend?: boolean): GridSelection;
export declare function selectionToTsv(data: GridSnapshot, selection: GridSelection): string;
export declare function selectionAddresses(selection: GridSelection): string[];
export declare function parseTsv(tsv: string): readonly (readonly string[])[];
export declare function applyTsvRows(data: GridSnapshot, start: GridPoint, rows: readonly (readonly string[])[], rowCount: number, columnCount: number, canEdit?: (point: GridPoint) => boolean): {
    data: Map<string, string>;
    selection: GridSelection;
};
export declare function pasteTsv(data: GridSnapshot, start: GridPoint, tsv: string, rowCount: number, columnCount: number, canEdit?: (point: GridPoint) => boolean): {
    data: Map<string, string>;
    selection: GridSelection;
};
export declare function clearSelection(data: GridSnapshot, selection: GridSelection, canEdit?: (point: GridPoint) => boolean): Map<string, string>;
export declare function shiftFormulaReferences(formula: string, rowDelta: number, columnDelta: number): string;
export declare function fillSelection(data: GridSnapshot, sourceSelection: GridSelection, target: GridPoint, rowCount: number, columnCount: number, canEdit?: (point: GridPoint) => boolean): {
    data: Map<string, string>;
    selection: GridSelection;
};
export declare function buildWorksheet(data: GridSnapshot): Worksheet;
export declare function displayValue(worksheet: Worksheet, point: GridPoint): string;
export declare function formulaErrorMessage(value: string): string | undefined;
export type CellDataType = "text" | "number" | "date" | "boolean" | "relationship";
export declare function validateTypedCell(value: string, dataType?: CellDataType, required?: boolean, options?: readonly string[]): string | undefined;
export declare function renameSheetReferences(input: string, previousLabel: string, nextLabel: string): string;
export type GridStructureChange = Readonly<{
    axis: "row" | "column";
    index: number;
    count: number;
    kind: "insert" | "delete";
}>;
export declare function changeGridStructure(data: GridSnapshot, change: GridStructureChange): Map<string, string>;
export declare function sortGridRows(data: GridSnapshot, column: number, direction: "asc" | "desc"): Map<string, string>;
export declare function selectionLabel(selection: GridSelection): string;
/** Return the populated extent of one column, independently of autocomplete ranking. */
export declare function populatedColumnSelection(data: GridSnapshot, column: number, excluded?: GridPoint): GridSelection | null;
export declare function addressToPoint(address: string): CellAddress;
export declare function formulaSuggestions(input: string, activeRow: number, fields: readonly {
    label: string;
    column: number;
}[], regions?: readonly FormulaRegion[]): readonly FormulaSuggestion[];
export declare function applyFormulaSuggestion(input: string, suggestion: FormulaSuggestion): string;
export type FormulaReferenceSelection = Readonly<{
    anchor: GridPoint;
    focus: GridPoint;
    tokenStart: number;
}>;
export declare function formulaReferenceLabel(selection: FormulaReferenceSelection): string;
export declare function applyFormulaReference(input: string, selection: FormulaReferenceSelection): string;
export declare function completeFormula(input: string): string;
/** Cycle the last cell/range reference through Excel-style absolute forms. */
export declare function cycleAbsoluteReference(input: string): string;
export declare function moveFormulaReference(current: FormulaReferenceSelection | null, editing: GridPoint, delta: GridPoint, extend: boolean, rowCount: number, columnCount: number, tokenStart: number): FormulaReferenceSelection;
export declare function formulaReferenceRanges(input: string): readonly GridSelection[];
