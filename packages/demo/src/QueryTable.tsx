import { useMemo, useRef, useState } from "react";
import {
  PagedSpreadsheet,
  TableFormattingToolbar,
  TableSurface,
  type DataPageCache,
  type PagedDataAdapter,
  type SpreadsheetHandle,
  type SpreadsheetSelection,
} from "sheetbase-table";
import { useWorkspace } from "sheetbase-shared";

/**
 * A table pane driven by the shared workspace: it reads `fields` and `query`,
 * so a search component editing the query filters this table live. The paged
 * adapter is host-owned so other panes (e.g. rules write-back) can commit
 * through the same boundary.
 */
export function QueryTable({ theme, adapter, pageCache }: { theme: "light" | "dark"; adapter: PagedDataAdapter; pageCache?: DataPageCache }) {
  const workspace = useWorkspace();
  const fields = workspace?.fields ?? [];
  const query = workspace?.query ?? {};
  const fieldIds = useMemo(() => fields.map((field) => field.id), [fields]);
  const datasetHeader = useMemo(
    () => ({ fields: fields.map((field, column) => ({ id: field.id, label: field.label, column, dataType: field.dataType === "datetime" ? "date" as const : field.dataType })) }),
    [fields],
  );
  const tableRef = useRef<SpreadsheetHandle>(null);
  const [selection, setSelection] = useState<SpreadsheetSelection>({ address: "A1", range: "A1", input: "" });
  if (fieldIds.length === 0) return null;
  return (
    <TableSurface
      theme={theme}
      table={
        <div className="formatted-table">
          <TableFormattingToolbar
            selection={selection.range}
            format={selection.format}
            mixedFormats={selection.mixedFormats}
            onFormat={(format) => tableRef.current?.applyFormat(format)}
            theme={theme}
          />
          <PagedSpreadsheet
            ref={tableRef}
            adapter={adapter}
            pageCache={pageCache}
            datasetId="sample"
            fieldIds={fieldIds}
            query={query}
            datasetHeader={datasetHeader}
            theme={theme}
            onSelectionChange={setSelection}
            showLoadStatus={false}
          />
        </div>
      }
    />
  );
}
