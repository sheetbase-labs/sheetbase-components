import { describe, expect, it } from "vitest";
import { columnDisplayDefaults, formatCellDisplay, type ColumnDisplayDefault } from "./column-display";

describe("formatCellDisplay", () => {
  const unitColumn: ColumnDisplayDefault = { unit: "IU/mL", precision: 1 };

  it("passes non-numeric and empty values through untouched", () => {
    expect(formatCellDisplay("abc", undefined, unitColumn)).toBe("abc");
    expect(formatCellDisplay("", undefined, unitColumn)).toBe("");
  });

  it("applies precision and a unit suffix to numeric cells", () => {
    expect(formatCellDisplay("3.14159", undefined, unitColumn)).toBe("3.1 IU/mL");
  });

  it("keeps raw precision when no column default exists", () => {
    expect(formatCellDisplay("42", undefined, undefined)).toBe("42");
  });

  it("applies precision without a unit for number-format columns", () => {
    expect(formatCellDisplay("96.65", undefined, { numberFormat: "number", precision: 1 })).toBe("96.7");
  });

  it("lets a cell's own painted format override the column default", () => {
    expect(formatCellDisplay("0.5", { numberFormat: "percent" }, unitColumn)).toBe("50%");
    expect(formatCellDisplay("2.5", { numberFormat: "currency" }, unitColumn)).toBe("£2.50");
  });

  it("suppresses the unit suffix for currency and percent formats", () => {
    // A column default of percent with a unit would be nonsense; the unit
    // must not leak into the formatted value.
    expect(formatCellDisplay("0.5", undefined, { numberFormat: "percent", unit: "IU/mL" })).toBe("50%");
  });

  it("keeps string cells that merely look partially numeric", () => {
    expect(formatCellDisplay("2026-08-28", undefined, unitColumn)).toBe("2026-08-28");
  });

  it("indexes display defaults by field.column, not array order", () => {
    const defaults = columnDisplayDefaults([
      { column: 2, unit: "IU/mL", precision: 1 },
      { column: 0, unit: "kg" },
    ]);
    expect(defaults[2]?.unit).toBe("IU/mL");
    expect(defaults[0]?.unit).toBe("kg");
    expect(defaults[1]).toBeUndefined();
  });
});

