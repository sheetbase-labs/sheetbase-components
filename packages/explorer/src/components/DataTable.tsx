import { useMemo } from "react";
import { DataGrid } from "@sheetbase-labs/sheetbase-table";
import { ROW_ID } from "../lib/explore";
import type { DataRow, Dataset } from "../lib/types";

interface Props {
  dataset: Dataset;
  rows?: DataRow[];
  selectedRow?: number;
  onSelectRow?(index: number): void;
}

/**
 * Data inspector. Rendering lives in the shared `DataGrid` (windowed, sortable,
 * shared `.sb-table` styling); explorer only supplies columns, rows and the
 * `ROW_ID` selection contract.
 */
export function DataTable({ dataset, rows: suppliedRows, selectedRow, onSelectRow }: Props) {
  const rows = useMemo(() => suppliedRows ?? dataset.rows, [suppliedRows, dataset.rows]);
  const columns = useMemo(
    () => dataset.columns.map((column) => ({ id: column.key, label: column.key, kind: column.kind })),
    [dataset.columns],
  );
  return (
    <DataGrid
      columns={columns}
      rows={rows}
      rowKey={(row) => String(row[ROW_ID] ?? "")}
      rownum={(row) => (typeof row[ROW_ID] === "number" ? Number(row[ROW_ID]) + 1 : "")}
      selectedKey={selectedRow !== undefined ? String(selectedRow) : undefined}
      onSelectRow={(key) => onSelectRow?.(Number(key))}
      sortable
      className="table-shell"
    />
  );
}
