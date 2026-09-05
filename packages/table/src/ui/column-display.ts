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
export function columnDisplayDefaults(fields: readonly ColumnDisplayField[]): readonly (ColumnDisplayDefault | undefined)[] {
  const defaults: (ColumnDisplayDefault | undefined)[] = [];
  for (const field of fields) {
    defaults[field.column] = {
      numberFormat: field.numberFormat,
      unit: field.unit,
      precision: field.precision,
    };
  }
  return defaults;
}

/**
 * Display-only formatting for a cell value. Numeric cells honour the column
 * default (precision, unit suffix) unless the cell's own format overrides the
 * number format; non-numeric and empty cells pass through untouched. A unit
 * suffix applies to plain and `number` formats only — never currency or
 * percent.
 */
const currencyFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const percentFormat = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 });

export function formatCellDisplay(
  calculated: string,
  cellFormat: Readonly<Pick<CellFormat, "numberFormat">> | undefined,
  columnDefault: ColumnDisplayDefault | undefined,
): string {
  const numeric =
    calculated !== "" && Number.isFinite(Number(calculated)) ? Number(calculated) : null;
  if (numeric === null) return calculated;
  const numberFormat = cellFormat?.numberFormat ?? columnDefault?.numberFormat;
  const unitApplies = numberFormat === undefined || numberFormat === "general" || numberFormat === "number";
  let text: string;
  switch (numberFormat) {
    case "currency":
      return currencyFormat.format(numeric);
    case "percent":
      return percentFormat.format(numeric);
    case "number":
      text =
        columnDefault?.precision !== undefined
          ? numeric.toFixed(columnDefault.precision)
          : String(numeric);
      break;
    default:
      text =
        columnDefault?.precision !== undefined ? numeric.toFixed(columnDefault.precision) : calculated;
      break;
  }
  const unit = columnDefault?.unit;
  return unitApplies && unit ? `${text} ${unit}` : text;
}
