export type Scalar = string | number | boolean | Date | null;

export type CellAddress = Readonly<{ row: number; column: number }>;
export type CellRange = Readonly<{
  start: CellAddress;
  end: CellAddress;
}>;

export type CellBinding =
  | { kind: "literal"; value: Scalar }
  | { kind: "formula"; expression: string }
  | {
      kind: "record-field";
      datasetId: string;
      recordId: string;
      fieldId: string;
    }
  | { kind: "query-result"; queryId: string; row: number; fieldId: string };

export type CellFormat = Readonly<{
  numberFormat?: "general" | "number" | "currency" | "percent" | "date";
  background?: string;
  foreground?: string;
  fontWeight?: 400 | 500 | 600 | 700;
  horizontalAlign?: "left" | "center" | "right";
}>;

export type DatasetField = Readonly<{
  id: string;
  label: string;
  dataType: "text" | "number" | "boolean" | "date" | "datetime";
  writable: boolean;
}>;

export type Dataset = Readonly<{
  id: string;
  label: string;
  sourceLabel: string;
  rowCount: number;
  fields: readonly DatasetField[];
}>;
