import { addressKey, type CellBinding, type Scalar } from "../engine";
import type { DatasetPage } from "./adapter";

export type DatasetColumnProjection = Readonly<{ column: number; fieldId: string }>;
export type MaterializedCell = Readonly<{ display: string; binding: CellBinding }>;
export type MaterializedPage = ReadonlyMap<string, MaterializedCell>;

function displayValue(value: Scalar): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Maps page-relative records to sheet coordinates without losing record identity. */
export function materializeDatasetPage(
  page: DatasetPage,
  columns: readonly DatasetColumnProjection[],
  headerRows = 0,
): MaterializedPage {
  const cells = new Map<string, MaterializedCell>();
  page.records.forEach((record, index) => {
    for (const column of columns) {
      const value = record.values[column.fieldId] ?? null;
      cells.set(addressKey({ row: headerRows + page.request.rowStart + index, column: column.column }), {
        display: displayValue(value),
        binding: {
          kind: "record-field",
          datasetId: page.request.datasetId,
          recordId: record.recordId,
          fieldId: column.fieldId,
        },
      });
    }
  });
  return cells;
}
