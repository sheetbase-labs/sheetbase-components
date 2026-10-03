import { describe, expect, it } from "vitest";
import { buildGridView, compareNullable, rowOffsetTable, viewCellKey, viewDisplayRow, viewSourceRow, type GridViewConfig } from "./view";

/**
 * A source table laid out as `rows[row][column]`, addressed by a field id per
 * column, so the view's ordering and filtering can be asserted directly.
 */
function fixture(rows: readonly (readonly string[])[], fieldIds: readonly string[] = ["name", "amount", "done"]) {
  const columnFor = (fieldId: string) => fieldIds.indexOf(fieldId) >= 0 ? fieldIds.indexOf(fieldId) : undefined;
  const config = (query: GridViewConfig["query"]): GridViewConfig => ({
    rowCount: rows.length,
    query,
    columnFor,
    valueAt: (row, column) => rows[row]?.[column] ?? "",
  });
  return { rows, config };
}

describe("buildGridView", () => {
  const table = [
    ["Beta", "10", "false"],
    ["Alpha", "2", "true"],
    ["Gamma", "2", "false"],
    ["Delta", "", "true"],
  ];

  it("is undefined when the query neither sorts nor filters", () => {
    const { config } = fixture(table);
    expect(buildGridView(config({}))).toBeUndefined();
    expect(buildGridView(config({ filters: [] }))).toBeUndefined();
    expect(buildGridView(config({ sort: [] }))).toBeUndefined();
  });

  it("orders rows by a sort clause without moving values", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({ sort: [{ fieldId: "name", direction: "asc" }] }));
    expect(view?.rows).toEqual([1, 0, 3, 2]);
    expect(view?.indexOf.get(1)).toBe(0);
  });

  it("sorts numerically when both values parse, and descending when asked", () => {
    const { config } = fixture(table);
    const ascending = buildGridView(config({ sort: [{ fieldId: "amount", direction: "asc" }] }));
    // Empty values lead ascending (locale order); numeric 2 < 2 < 10 elsewhere.
    expect(ascending?.rows).toEqual([3, 1, 2, 0]);
    const descending = buildGridView(config({ sort: [{ fieldId: "amount", direction: "desc", nulls: "first" }] }));
    expect(descending?.rows).toEqual([3, 0, 1, 2]);
    // A sort that lands on the source order is the identity view.
    expect(buildGridView(config({ sort: [{ fieldId: "amount", direction: "desc" }] }))).toBeUndefined();
  });

  it("honours an explicit nulls side", () => {
    const { config } = fixture(table);
    const first = buildGridView(config({ sort: [{ fieldId: "amount", direction: "asc", nulls: "first" }] }));
    expect(first?.rows).toEqual([3, 1, 2, 0]);
  });

  it("applies later sort clauses as tie-breakers", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({
      sort: [
        { fieldId: "amount", direction: "asc" },
        { fieldId: "name", direction: "desc" },
      ],
    }));
    // amount asc leads with the empty row; the two 2s break by name desc.
    expect(view?.rows).toEqual([3, 2, 1, 0]);
  });

  it("hides rows that fail a flat filter", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({ filters: [{ fieldId: "done", operator: "eq", value: true }] }));
    expect(view?.rows).toEqual([1, 3]);
  });

  it("applies the flat filter logic and drops clauses for unknown fields", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({
      filters: [
        { fieldId: "name", operator: "contains", value: "l" },
        { fieldId: "missing", operator: "eq", value: "x" },
      ],
    }));
    expect(view?.rows).toEqual([1, 3]);
  });

  it("prefers the filter tree when one is present", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({
      filters: [{ fieldId: "done", operator: "eq", value: true }],
      filterTree: {
        type: "group",
        id: "root",
        combinator: "NOT",
        children: [{ type: "condition", id: "c1", field: "done", operator: "eq", value: true }],
      },
    }));
    expect(view?.rows).toEqual([0, 2]);
  });

  it("returns an empty view when nothing matches", () => {
    const { config } = fixture(table);
    const view = buildGridView(config({ filters: [{ fieldId: "name", operator: "eq", value: "Nope" }] }));
    expect(view?.rows).toEqual([]);
    expect(view?.indexOf.size).toBe(0);
  });

  it("is undefined when the filter matches every row in order", () => {
    const { config } = fixture(table);
    expect(buildGridView(config({ filters: [{ fieldId: "name", operator: "notNull" }] }))).toBeUndefined();
  });

  it("evaluates rows the grid has not loaded as empty", () => {
    const rows = [["Alpha"]];
    const { config } = fixture(rows, ["name"]);
    const view = buildGridView({ ...config({ filters: [{ fieldId: "name", operator: "isNull" }] }), rowCount: 3 });
    expect(view?.rows).toEqual([1, 2]);
  });

  it("excludes placeholder rows with no record from the view", () => {
    const { config } = fixture(table);
    const view = buildGridView({
      ...config({ sort: [{ fieldId: "name", direction: "asc" }] }),
      hasRow: (row) => row < 2,
    });
    // Only the two loaded records are ordered; the placeholders stay out.
    expect(view?.rows).toEqual([1, 0]);
  });
});

describe("rowOffsetTable", () => {
  it("prefix-sums the heights of the displayed rows", () => {
    expect(rowOffsetTable(3, (index) => [10, 20, 30][index])).toEqual([0, 10, 30, 60]);
    expect(rowOffsetTable(0, () => 10)).toEqual([0]);
  });

  it("lets a view place the displayed order's heights", () => {
    const heights = [10, 20, 30];
    const view = { rows: [2, 0], indexOf: new Map([[2, 0], [0, 1]]) };
    expect(rowOffsetTable(view.rows.length, (index) => heights[view.rows[index]])).toEqual([0, 30, 40]);
  });
});

describe("view mapping helpers", () => {
  const view = { rows: [2, 0], indexOf: new Map([[2, 0], [0, 1]]) };

  it("maps displayed rows to source rows and back", () => {
    expect(viewSourceRow(view, 0)).toBe(2);
    expect(viewSourceRow(view, 1)).toBe(0);
    expect(viewSourceRow(view, 2)).toBe(-1);
    expect(viewDisplayRow(view, 0)).toBe(1);
    expect(viewDisplayRow(view, 2)).toBe(0);
    expect(viewDisplayRow(view, 9)).toBe(-1);
  });

  it("is the identity mapping without a view", () => {
    expect(viewSourceRow(undefined, 7)).toBe(7);
    expect(viewDisplayRow(undefined, 7)).toBe(7);
    expect(viewCellKey(undefined, { row: 2, column: 1 })).toBe("B3");
  });

  it("resolves a displayed coordinate to the stored address, and empty when hidden", () => {
    expect(viewCellKey(view, { row: 0, column: 1 })).toBe("B3");
    expect(viewCellKey(view, { row: 1, column: 0 })).toBe("A1");
    expect(viewCellKey(view, { row: 5, column: 0 })).toBe("");
  });
});

describe("compareNullable", () => {
  it("sorts empty values first ascending and last descending", () => {
    expect(compareNullable("", "a", "asc")).toBe(-1);
    expect(compareNullable("a", "", "asc")).toBe(1);
    expect(compareNullable("", "a", "desc")).toBe(1);
    expect(compareNullable("a", "", "desc")).toBe(-1);
  });

  it("honours an explicit nulls side over the direction default", () => {
    expect(compareNullable("", "a", "asc", "last")).toBe(1);
    expect(compareNullable("", "a", "desc", "first")).toBe(-1);
  });

  it("compares numbers numerically and text case-insensitively", () => {
    expect(compareNullable("2", "10", "asc")).toBeLessThan(0);
    expect(compareNullable("Alpha", "alpha", "asc")).toBe(0);
  });
});
