import { describe, expect, it } from "vitest";
import { evaluateBytecode, lowerFormula } from "./bytecode";
import { compileFormula, evaluateCompiledFormula } from "./formulas";

describe("formula bytecode", () => {
  it("matches AST semantics and lowers IF to branches", () => {
    const compiled = compileFormula("=IF(A1>5,SUM(A1:A2)*2,99)");
    const program = lowerFormula(compiled);
    const resolve = (address: string) => ({ A1: 7, A2: 3 })[address] ?? null;
    expect(program.instructions.some((instruction) => instruction.op === "jump-if-false")).toBe(true);
    expect(evaluateBytecode(program, resolve)).toBe(evaluateCompiledFormula(compiled, resolve));
    expect(evaluateBytecode(program, () => 2)).toBe(99);
  });

  it("supports lookup and UTC date functions", () => {
    const values: Record<string, string | number> = { A1: "a", A2: "b", B1: 10, B2: 20 };
    const evaluate = (formula: string) => evaluateBytecode(lowerFormula(compileFormula(formula)), (address) => values[address] ?? null);
    expect(evaluate('=XLOOKUP("b",A1:A2,B1:B2)')).toBe(20);
    expect(evaluate('=MATCH("a",A1:A2)')).toBe(1);
    expect(evaluate("=YEAR(DATE(2026,9,2))+MONTH(DATE(2026,9,2))+DAY(DATE(2026,9,2))")).toBe(2037);
  });

  it("returns a bare range as a dynamic array", () => {
    const values: Record<string, string> = { F1: "2026-08-28", F2: "2026-08-29", F3: "2026-08-30" };
    expect(evaluateBytecode(lowerFormula(compileFormula("=F1:F3")), (address) => values[address] ?? null)).toEqual({
      kind: "spill",
      values: [["2026-08-28"], ["2026-08-29"], ["2026-08-30"]],
    });
  });

  it("evaluates ISERROR and IFERROR on bytecode", () => {
    const evaluate = (formula: string) => evaluateBytecode(lowerFormula(compileFormula(formula)), () => null);
    expect(evaluate("=ISERROR(4)")).toBe(false);
    expect(evaluate("=ISERROR(1/0)")).toBe(true);
    expect(evaluate('=IFERROR(1/0, "safe")')).toBe("safe");
    expect(evaluate("=IFERROR(5, 9)")).toBe(5);
    expect(evaluate("=IF(TRUE,1,0)+IFERROR(1/0,2)")).toBe(3);
    expect(() => evaluate("=IFERROR(1/0, 1/0)")).toThrow("#DIV/0!");
  });
});

describe("defined names", () => {
  it("lowers compile-time name expansion without new ops", () => {
    const compiled = compileFormula("=SUM(Sales_Q1)", new Map([["SALES_Q1", "Inputs!A1:A2"]]));
    const program = lowerFormula(compiled);
    const knownOps = new Set([
      "push", "reference", "range", "unary", "binary", "call",
      "jump-if-false", "jump", "drop", "catch", "uncatch",
    ]);
    expect(program.instructions.every((instruction) => knownOps.has(instruction.op))).toBe(true);
    expect(program.dependencies).toEqual(["Inputs!A1", "Inputs!A2"]);
    const resolve = (address: string) => ({ "Inputs!A1": 3, "Inputs!A2": 4 })[address] ?? null;
    expect(evaluateBytecode(program, resolve)).toBe(evaluateCompiledFormula(compiled, resolve));
    expect(evaluateBytecode(program, resolve)).toBe(7);
  });
});
