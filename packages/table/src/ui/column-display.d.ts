import type { CellFormat } from "../engine/types";
/**
 * Declarative per-column display defaults, sourced from
 * `datasetHeader.fields` (units, precision, number format). Display only —
 * the stored cell value is never rewritten, and a cell's own painted
 * `CellFormat.numberFormat` wins over the column default.
 */
export interface ColumnDisplayDefault {
    numberFormat?: CellFormat["numberFormat"];
    unit?: string;
    precision?: number;
}
export type ColumnDisplayField = Readonly<{
    column: number;
    unit?: string;
    precision?: number;
    numberFormat?: CellFormat["numberFormat"];
}>;
/** Index defaults by `field.column`, not by array position. */
export declare function columnDisplayDefaults(fields: readonly ColumnDisplayField[]): readonly (ColumnDisplayDefault | undefined)[];
export declare function formatCellDisplay(calculated: string, cellFormat: Readonly<Pick<CellFormat, "numberFormat">> | undefined, columnDefault: ColumnDisplayDefault | undefined): string;
