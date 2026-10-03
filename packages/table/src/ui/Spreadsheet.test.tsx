import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spreadsheet } from "./Spreadsheet";

describe("Spreadsheet gridline background", () => {
  const render = (props: Partial<Parameters<typeof Spreadsheet>[0]>) =>
    renderToStaticMarkup(<Spreadsheet initialData={new Map()} rowCount={8} columnCount={3} {...props} />);

  it("keeps the default preset's 31px row rhythm", () => {
    expect(render({})).toContain("background-size:140px 31px");
  });

  it("follows an explicit row height instead of the literal 31px", () => {
    expect(render({ defaultRowHeight: 28 })).toContain("background-size:140px 28px");
  });

  it("accepts the host hooks without disturbing the default render", () => {
    const html = render({
      beforeCellsChange: () => false,
      clipboard: { onCopy: () => false, onCutStatusChange: () => {} },
      columnMenuItems: [{ label: "Open record", onSelect: () => {} }],
      onSortChange: () => {},
      onFiltersChange: () => {},
      datasetHeader: { fields: [{ id: "owner", label: "Owner", column: 0, displayText: () => undefined }] },
    });
    expect(html).toContain("grid-canvas");
  });
});
