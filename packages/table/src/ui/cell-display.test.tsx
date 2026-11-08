import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CELL_DISPLAY_FIXTURES, cellDisplayModel, formatDisplayNumber, sparklineValues } from "./cell-display";
import { renderCellDisplay } from "./cell-display-view";

describe("cell displays", () => {
  for (const [index, fixture] of CELL_DISPLAY_FIXTURES.entries()) {
    it(`fixture ${index}: ${fixture.spec.kind} of ${JSON.stringify(fixture.value)}`, () => {
      expect(cellDisplayModel(fixture.spec, fixture.value)).toEqual(fixture.expect);
    });
  }

  it("groups and rounds numbers", () => {
    expect(formatDisplayNumber(1234567.891, 2, true)).toBe("1,234,567.89");
    expect(formatDisplayNumber(5, undefined, false)).toBe("5");
  });

  it("reads sparkline lists from JSON, commas and spaces", () => {
    expect(sparklineValues("[1,2,3]")).toEqual([1, 2, 3]);
    expect(sparklineValues("1 2;3")).toEqual([1, 2, 3]);
    expect(sparklineValues("nope")).toEqual([]);
  });

  it("draws a badge, a bar and a sparkline", () => {
    const badge = renderToStaticMarkup(<>{renderCellDisplay({ kind: "badge", tones: { pass: "success" } }, "pass")}</>);
    expect(badge).toContain("pass");
    const bar = renderToStaticMarkup(<>{renderCellDisplay({ kind: "bar", max: 100 }, 40)}</>);
    expect(bar).toContain('aria-valuenow="40"');
    const spark = renderToStaticMarkup(<>{renderCellDisplay({ kind: "sparkline" }, "1,3,2")}</>);
    expect(spark).toContain("<polyline");
  });

  it("draws nothing for an empty value, and no svg without a cleaner", () => {
    expect(renderToStaticMarkup(<>{renderCellDisplay({ kind: "text" }, "")}</>)).toBe("");
    expect(renderToStaticMarkup(<>{renderCellDisplay({ kind: "svg" }, "<svg onload='x()'/>")}</>)).toBe("");
    expect(renderToStaticMarkup(<>{renderCellDisplay({ kind: "svg" }, "<svg/>", (s) => s)}</>)).toContain("<svg/>");
  });
});
