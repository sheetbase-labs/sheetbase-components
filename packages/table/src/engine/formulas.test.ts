import { describe, expect, it } from "vitest";
import { assertValidName, compileFormula, editableDependencies, evaluateCompiledFormula } from "./formulas";

describe("compiled formulas", () => {
  it("builds a serialisable AST once and evaluates it repeatedly", () => {
    const program = compileFormula("=IF(A1>5,SUM(A1:A2),0)");
    expect(program.dependencies).toEqual(["A1", "A2"]);
    expect(evaluateCompiledFormula(program, (address) => ({ A1: 7, A2: 3 })[address] ?? null)).toBe(10);
    expect(evaluateCompiledFormula(program, (address) => ({ A1: 2, A2: 3 })[address] ?? null)).toBe(0);
    expect(JSON.parse(JSON.stringify(program))).toEqual(program);
  });

  it("compiles quoted and unquoted cross-sheet ranges", () => {
    expect(compileFormula("=SUM('Raw Data'!A1:A2)+Inputs!B1").dependencies).toEqual([
      "Raw Data!A1", "Raw Data!A2", "Inputs!B1",
    ]);
  });

  it("does not throw while an incomplete formula is being edited", () => {
    expect(editableDependencies("=")).toEqual([]);
    expect(editableDependencies("=SUM(")).toEqual([]);
    expect(editableDependencies("=A1+")).toEqual([]);
  });
});

describe("defined names", () => {
  const names = new Map([["SALES_Q1", "Inputs!A1:A3"]]);

  it("expands a defined name to its target range for dependencies", () => {
    expect(compileFormula("=SUM(Sales_Q1)", names).dependencies).toEqual(["Inputs!A1", "Inputs!A2", "Inputs!A3"]);
  });

  it("matches names case-insensitively even with lowercase table keys", () => {
    expect(compileFormula("=SUM(SALES_Q1)", new Map([["sales_q1", "Inputs!A1:A2"]])).dependencies).toEqual([
      "Inputs!A1",
      "Inputs!A2",
    ]);
  });

  it("expands a single-cell name to a reference", () => {
    expect(compileFormula("=Tax_Rate*2", new Map([["TAX_RATE", "Inputs!B1"]])).dependencies).toEqual(["Inputs!B1"]);
  });

  it("evaluates through the expanded range", () => {
    const program = compileFormula("=SUM(Sales_Q1)", names);
    const resolve = (address: string) => ({ "Inputs!A1": 1, "Inputs!A2": 2, "Inputs!A3": 3 })[address] ?? null;
    expect(evaluateCompiledFormula(program, resolve)).toBe(6);
  });

  it("still reports #NAME? for unknown bare identifiers", () => {
    expect(() => compileFormula("=SUM(Nope_Missing)", names)).toThrow("#NAME?");
    expect(() => compileFormula("=Nope_Missing", names)).toThrow("#NAME?");
  });

  it("rejects invalid names and A1 collisions", () => {
    expect(() => assertValidName("A1")).toThrow();
    expect(() => assertValidName("Q1")).toThrow();
    expect(() => assertValidName("XFD1048576")).toThrow();
    expect(() => assertValidName("1ABC")).toThrow();
    expect(() => assertValidName("Has Space")).toThrow();
    expect(() => assertValidName("")).toThrow();
    expect(assertValidName("Sales_Q1")).toBeUndefined();
    expect(assertValidName("_rate.v2")).toBeUndefined();
  });
});
