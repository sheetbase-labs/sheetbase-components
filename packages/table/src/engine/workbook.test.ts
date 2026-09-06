import { describe, expect, it } from "vitest";
import { Worksheet } from "./workbook";
import { localFormulaExecutor } from "./calculation";

describe("Worksheet", () => {
  it("evaluates arithmetic and SUM formulas", () => {
    const sheet = new Worksheet();
    sheet.set("A1", 10);
    sheet.set("A2", 20);
    sheet.set("A3", { kind: "formula", expression: "=SUM(A1:A2) * 2" });
    expect(sheet.value("A3")).toBe(60);
    expect(sheet.dependents("A1")).toContain("A3");
    expect(sheet.dependents("A2")).toContain("A3");
  });

  it("detects circular references", () => {
    const sheet = new Worksheet();
    sheet.set("A1", { kind: "formula", expression: "=A2" });
    sheet.set("A2", { kind: "formula", expression: "=A1" });
    expect(() => sheet.value("A1")).toThrow("Circular reference");
  });

  it("removes old dependency edges when a formula is replaced", () => {
    const sheet = new Worksheet();
    sheet.setInput("B1", "=A1*2");
    expect(sheet.dependents("A1")).toEqual(["B1"]);
    sheet.setInput("B1", "plain text");
    expect(sheet.dependents("A1")).toEqual([]);
  });

  it("supports aggregate formulas and absolute references", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "10");
    sheet.setInput("A2", "20");
    sheet.setInput("A3", "text");
    sheet.setInput("B1", "=AVERAGE($A$1:$A$2)");
    sheet.setInput("B2", "=MIN(A1:A2)+MAX(A1:A2)+COUNT(A1:A3)");
    expect(sheet.value("B1")).toBe(15);
    expect(sheet.value("B2")).toBe(32);
  });

  it("resolves structured bindings inside ordinary formulas", () => {
    const sheet = new Worksheet((binding) => binding.kind === "record-field" ? 12 : null);
    sheet.set("A1", { kind: "record-field", datasetId: "experiments", recordId: "exp-1", fieldId: "result" });
    sheet.setInput("B1", "=A1*2");
    expect(sheet.value("B1")).toBe(24);
  });

  it("parses precedence, comparisons, strings and scalar functions without JavaScript evaluation", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "=2+3*4^2");
    sheet.setInput("A2", '=ROUND(10/3,2)');
    sheet.setInput("A3", '="run"&" complete"');
    sheet.setInput("A4", "=A1>40");
    sheet.setInput("A5", "=ABS(-4)+SQRT(9)");
    expect(sheet.value("A1")).toBe(50);
    expect(sheet.value("A2")).toBe(3.33);
    expect(sheet.value("A3")).toBe("run complete");
    expect(sheet.value("A4")).toBe(true);
    expect(sheet.value("A5")).toBe(7);
  });

  it("caches values and invalidates only the transitive dependent subgraph", () => {
    let resolutions = 0;
    const sheet = new Worksheet(() => { resolutions += 1; return 10; });
    sheet.set("A1", { kind: "record-field", datasetId: "d", recordId: "r", fieldId: "f" });
    sheet.setInput("B1", "=A1*2");
    sheet.setInput("C1", "=B1+1");
    sheet.setInput("D1", "=100+1");
    expect(sheet.value("C1")).toBe(21);
    expect(sheet.value("C1")).toBe(21);
    expect(sheet.value("D1")).toBe(101);
    expect(resolutions).toBe(1);
    sheet.invalidate("A1");
    expect(sheet.dirtyCells()).toEqual(expect.arrayContaining(["A1", "B1", "C1"]));
    expect(sheet.dirtyCells()).not.toContain("D1");
    expect(sheet.value("C1")).toBe(21);
    expect(resolutions).toBe(2);
  });

  it("recalculates dirty cells in topological batches", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "10");
    sheet.setInput("B1", "20");
    sheet.setInput("C1", "=A1+B1");
    sheet.setInput("D1", "=C1*2");
    sheet.setInput("E1", "=B1+1");
    expect(sheet.recalculationPlan()).toEqual({
      batches: [["A1", "B1"], ["C1", "E1"], ["D1"]],
      cyclic: [],
    });
    expect(sheet.recalculate().get("D1")).toBe(60);
    expect(sheet.dirtyCells()).toEqual([]);
  });

  it("executes independent formula batches asynchronously", async () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "5");
    sheet.setInput("B1", "=A1*2");
    sheet.setInput("C1", "=A1+3");
    sheet.setInput("D1", "=B1+C1");
    const batchSizes: number[] = [];
    const values = await sheet.recalculateAsync(async (tasks) => {
      batchSizes.push(tasks.length);
      return localFormulaExecutor(tasks);
    });
    expect(batchSizes).toEqual([2, 1]);
    expect(values.get("D1")).toBe(18);
  });

  it("cleans deleted cells during recalculation", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "10");
    sheet.delete("A1");
    expect(sheet.dirtyCells()).toEqual(["A1"]);
    expect(sheet.recalculate().get("A1")).toBeNull();
    expect(sheet.dirtyCells()).toEqual([]);
  });

  it("materialises and replaces dynamic array spills", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "=SEQUENCE(2,2,10,5)");
    expect(sheet.value("A1")).toBe(10);
    expect(sheet.value("B1")).toBe(15);
    expect(sheet.value("A2")).toBe(20);
    expect(sheet.value("B2")).toBe(25);
    sheet.setInput("A1", "=SEQUENCE(1,1,7)");
    expect(sheet.value("A1")).toBe(7);
    expect(sheet.value("B2")).toBeNull();
  });

  it("returns a spill error when output cells are occupied", () => {
    const sheet = new Worksheet();
    sheet.setInput("B1", "occupied");
    sheet.setInput("A1", "=SEQUENCE(1,2)");
    expect(() => sheet.value("A1")).toThrow("#SPILL!");
  });

  it("retains incomplete formulas as visible spreadsheet errors", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "=");
    expect(sheet.input("A1")).toBe("=");
    expect(() => sheet.value("A1")).toThrow("#VALUE!");
    sheet.setInput("A1", "=1+1");
    expect(sheet.value("A1")).toBe(2);
  });

  it("keeps structured formula text while calculating its resolved range", () => {
    const ranges = new Map([["result", "A1:A2"]]);
    const sheet = new Worksheet(undefined, undefined, (expression) =>
      expression.replace(/\[([^\]]+)\]/g, (token, fieldId: string) => ranges.get(fieldId) ?? token),
    );
    sheet.setInput("A1", "10");
    sheet.setInput("A2", "20");
    sheet.setInput("B1", "=SUM([result])");
    expect(sheet.input("B1")).toBe("=SUM([result])");
    expect(sheet.value("B1")).toBe(30);
  });

  it("re-resolves structured formulas after a dataset range changes", () => {
    let resultRange = "A1:A2";
    const sheet = new Worksheet(undefined, undefined, (expression) => expression.replace("[result]", resultRange));
    sheet.setInput("A1", "10");
    sheet.setInput("A2", "20");
    sheet.setInput("A3", "30");
    sheet.setInput("B1", "=SUM([result])");
    expect(sheet.value("B1")).toBe(30);
    resultRange = "A1:A3";
    sheet.renormalizeFormulas();
    expect(sheet.value("B1")).toBe(60);
    expect(sheet.input("B1")).toBe("=SUM([result])");
  });

  it("spills a bare structured column reference", () => {
    const sheet = new Worksheet(undefined, undefined, (expression) => expression.replace("[run_date]", "F1:F3"));
    sheet.setInput("F1", "2026-08-28");
    sheet.setInput("F2", "2026-08-29");
    sheet.setInput("F3", "2026-08-30");
    sheet.setInput("I1", "=[run_date]");
    expect(sheet.value("I1")).toBe("2026-08-28");
    expect(sheet.value("I2")).toBe("2026-08-29");
    expect(sheet.value("I3")).toBe("2026-08-30");
  });
});

describe("Worksheet formula modes", () => {
  it("evaluates formulas by default", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "=1+1");
    expect(sheet.value("A1")).toBe(2);
  });

  it("stores formula inputs as inert text in literal mode", () => {
    const sheet = new Worksheet(undefined, undefined, undefined, { formulaMode: "literal" });
    sheet.setInput("A1", "=SUM(B1:B9)");
    expect(sheet.value("A1")).toBe("=SUM(B1:B9)");
    expect(sheet.input("A1")).toBe("=SUM(B1:B9)");
    expect(sheet.binding("A1")?.kind).toBe("literal");
    expect(sheet.dependents("B1")).toEqual([]);
    sheet.setInput("B1", "7");
    expect(sheet.value("A1")).toBe("=SUM(B1:B9)");
  });

  it("keeps ordinary literals working in literal mode", () => {
    const sheet = new Worksheet(undefined, undefined, undefined, { formulaMode: "literal" });
    sheet.setInput("A2", "5");
    sheet.setInput("A3", "sample text");
    expect(sheet.value("A2")).toBe(5);
    expect(sheet.value("A3")).toBe("sample text");
  });

  it("rebinds existing formula cells when the mode changes", () => {
    const sheet = new Worksheet();
    sheet.setInput("A1", "=1+1");
    expect(sheet.value("A1")).toBe(2);
    sheet.setFormulaMode("literal");
    expect(sheet.value("A1")).toBe("=1+1");
    expect(sheet.binding("A1")?.kind).toBe("literal");
    sheet.setFormulaMode("evaluate");
    expect(sheet.value("A1")).toBe(2);
    expect(sheet.binding("A1")?.kind).toBe("formula");
  });
});

describe("Worksheet defined names", () => {
  /** A standalone sheet whose qualified targets resolve against itself. */
  function selfResolvingSheet(): Worksheet {
    const sheet = new Worksheet();
    sheet.setReferenceResolver((reference) => sheet.value(reference.slice(reference.indexOf("!") + 1)));
    return sheet;
  }

  it("defines, resolves, redefines and deletes names case-insensitively", () => {
    const sheet = new Worksheet();
    sheet.defineName("Sales_Q1", { sheet: "Data", range: "A1:A3" });
    expect(sheet.resolveName("sales_q1")).toBe("Data!A1:A3");
    expect(sheet.resolveName("SALES_Q1")).toBe("Data!A1:A3");
    sheet.defineName("SALES_Q1", { sheet: "Data", range: "B1:B2" });
    expect(sheet.resolveName("Sales_Q1")).toBe("Data!B1:B2");
    sheet.deleteName("sAlEs_Q1");
    expect(sheet.resolveName("Sales_Q1")).toBeUndefined();
  });

  it("rejects invalid names and A1 addresses", () => {
    const sheet = new Worksheet();
    expect(() => sheet.defineName("A1", { sheet: "Data", range: "A1:A3" })).toThrow();
    expect(() => sheet.defineName("B27", { sheet: "Data", range: "A1" })).toThrow();
    expect(() => sheet.defineName("1st", { sheet: "Data", range: "A1" })).toThrow();
  });

  it("evaluates =SUM(Sales_Q1) end to end and invalidates through the target", () => {
    const sheet = selfResolvingSheet();
    sheet.setInput("A1", "1");
    sheet.setInput("A2", "2");
    sheet.setInput("A3", "3");
    sheet.defineName("Sales_Q1", { sheet: "Data", range: "A1:A3" });
    sheet.setInput("B1", "=SUM(Sales_Q1)");
    expect(sheet.value("B1")).toBe(6);
    sheet.setInput("A2", "20");
    expect(sheet.value("B1")).toBe(24);
  });

  it("reports #NAME? after the name is deleted", () => {
    const sheet = selfResolvingSheet();
    sheet.setInput("A1", "5");
    sheet.defineName("Rate", { sheet: "Data", range: "A1" });
    sheet.setInput("B1", "=Rate*2");
    expect(sheet.value("B1")).toBe(10);
    sheet.deleteName("RATE");
    expect(() => sheet.value("B1")).toThrow("#NAME?");
  });
});
