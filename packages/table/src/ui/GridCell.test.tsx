import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GridCell, type GridCellHandlers, type GridCellProps } from "./GridCell";

const handlers = createRef<GridCellHandlers>();
handlers.current = { pointerDown: () => {}, pointerEnter: () => {}, doubleClick: () => {}, badgeClick: () => {} };
const handlersRef = handlers as React.RefObject<GridCellHandlers>;

const render = (props: Partial<GridCellProps>) => renderToStaticMarkup(<GridCell
  address="A1"
  row={0}
  column={0}
  display="true"
  isFormula={false}
  selected={false}
  active={false}
  loading={false}
  className="grid-cell"
  handlers={handlersRef}
  left={0}
  top={0}
  width={100}
  height={31}
  {...props}
/>);

describe("GridCell boolean rendering", () => {
  it("paints a checked mark instead of the literal text", () => {
    const html = render({ booleanValue: true });
    expect(html).toContain('class="cell-boolean"');
    expect(html).toContain('data-boolean="true"');
    expect(html).toContain('aria-label="True"');
    expect(html).not.toContain(">true<");
  });

  it("paints an unchecked mark for false", () => {
    const html = render({ booleanValue: false, display: "false" });
    expect(html).toContain('data-boolean="false"');
    expect(html).toContain('aria-label="False"');
  });

  it("keeps the plain text rendering when no boolean is supplied", () => {
    expect(render({})).toContain(">true<");
  });

  it("lets a host renderCell override win over the boolean mark", () => {
    const html = render({ booleanValue: true, renderCell: ({ display }) => <em>{display}</em> });
    expect(html).toContain("<em>true</em>");
    expect(html).not.toContain("cell-boolean");
  });

  it("keeps a diff state ahead of the boolean mark", () => {
    const html = render({ booleanValue: true, cellState: { state: "diff", before: "false", after: "true" } });
    expect(html).toContain("cell-diff");
    expect(html).not.toContain("cell-boolean");
  });
});
