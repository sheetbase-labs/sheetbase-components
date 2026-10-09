import { describe, expect, it } from "vitest";
import { evaluateBytecode, lowerFormula } from "./bytecode";
import { compileFormula } from "./formulas";
import type { SpillMatrix } from "./spill-store";
import type { Scalar } from "./types";

/**
 * ADR-0048 COMP-06 formula parity suite.
 *
 * The ADR does not enumerate its 146-formula corpus, so this suite derives it
 * from what the ADR does name: a representative call for each of the 18
 * statistical functions the ELN `scientific-core-v2` profile requires (the
 * ADR's absence list), the ADR difference table, and the formulas the ELN's
 * `formula-ir` / `calculation.server` / `test:phase4` expectations exercise
 * (`=A1*2`, `=1/0`, `=RAND()`, `SUM/IF/AND/ROUND/LOG10`, cross-sheet refs).
 * Each case runs through the production compiled path (`compileFormula` ->
 * `lowerFormula` -> `evaluateBytecode`) so a regression in the tokenizer,
 * compiler, bytecode or function library fails here.
 *
 * Expected values for the statistical functions come from the reference engine
 * (HyperFormula 3.3.0 under the ELN's `SHEETBASE_HF_CONFIG`) and are asserted to
 * six decimal places; HyperFormula rounds at `precisionRounding: 10`. The
 * semantic rows assert the reconciled `sheetbase-table` behaviour (option (b)
 * makes this engine the single authority), spelled out per row.
 */

type Outcome = Scalar | SpillMatrix;

const SHEET: Record<string, Scalar> = {
  A1: 1, A2: 2, A3: 3, A4: 4, A5: 5,
  B1: 1, B2: 3, B3: 5, B4: 7, B5: 9,
  E1: 10, F1: 20, E2: 30, F2: 40,
  G1: 15, H1: 15, G2: 35, H2: 35,
  "Raw Data!A1": 1, "Raw Data!A2": 2, "Inputs!B1": 3,
};

function evaluate(formula: string): Outcome {
  return evaluateBytecode(lowerFormula(compileFormula(formula)), (address) => SHEET[address] ?? null);
}

function errorOf(formula: string): string {
  try {
    evaluate(formula);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected ${formula} to raise an error`);
}

const spill = (values: Scalar[][]): SpillMatrix => ({ kind: "spill", values });

/** The 18 statistical functions the ADR lists as absent. */
const STATISTICAL_CORPUS: ReadonlyArray<readonly [string, number]> = [
  ["=NORM.DIST(50,40,10,TRUE)", 0.84134474607],
  ["=NORM.INV(0.9,40,10)", 52.815515655],
  ["=NORM.S.DIST(1.5,TRUE)", 0.93319279873],
  ["=NORM.S.INV(0.975)", 1.9599639845],
  ["=T.DIST(1.5,10,TRUE)", 0.91774633678],
  ["=T.DIST.2T(2.086,20)", 0.049996354568],
  ["=T.INV(0.975,20)", 2.085963406],
  ["=T.INV.2T(0.05,20)", 2.085963406],
  ["=T.TEST(A1:A5,B1:B5,2,1)", 0.047420655584],
  ["=CHISQ.DIST(3.84,1,TRUE)", 0.94995647875],
  ["=CHISQ.INV(0.95,1)", 3.8414588206],
  ["=CHISQ.TEST(E1:F2,G1:H2)", 0.029096331741],
  ["=F.DIST(4,5,10,TRUE)", 0.97032470479],
  ["=F.INV(0.95,5,10)", 3.3258345292],
  ["=F.TEST(A1:A5,B1:B5)", 0.208],
  ["=CONFIDENCE.NORM(0.05,2.5,50)", 0.69295191217],
  ["=CONFIDENCE.T(0.05,1,10)", 0.71535690452],
  ["=STDEVPA(A1:A5)", Math.SQRT2],
];

/** Fixture formulas the existing ELN suites evaluate (`formula-ir`, `calculation.server`, `test:phase4`). */
const FIXTURE_CORPUS: ReadonlyArray<readonly [string, Scalar]> = [
  ["=A1*2", 2],
  ["=SUM(A1:A3)", 6],
  ["=IF(A1>0,\"yes\",\"no\")", "yes"],
  ["=ROUND(2.345,2)", 2.35],
  ["=LOG10(1000)", 3],
  ["=SUM('Raw Data'!A1:A2)+Inputs!B1", 6],
];

describe("ADR-0048 formula parity (compiled path)", () => {
  it.each(STATISTICAL_CORPUS)("matches the reference engine for %s", (formula, expected) => {
    expect(evaluate(formula)).toBeCloseTo(expected, 6);
  });

  it("covers all 18 required statistical functions", () => {
    const covered = new Set(
      STATISTICAL_CORPUS.map(([formula]) => /^=([A-Z.0-9]+)\(/.exec(formula)?.[1] ?? ""),
    );
    const required = [
      "CHISQ.DIST", "CHISQ.INV", "CHISQ.TEST", "CONFIDENCE.NORM", "CONFIDENCE.T",
      "F.DIST", "F.INV", "F.TEST", "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV",
      "STDEVPA", "T.DIST", "T.DIST.2T", "T.INV", "T.INV.2T", "T.TEST",
    ];
    expect([...covered].sort()).toEqual(required);
  });

  it.each(FIXTURE_CORPUS)("evaluates the ELN fixture %s", (formula, expected) => {
    expect(evaluate(formula)).toEqual(expected);
  });

  it("draws RAND inside [0, 1)", () => {
    const draw = evaluate("=RAND()") as number;
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
  });
});

describe("ADR-0048 semantic parity rows", () => {
  it("treats TRUE/FALSE as boolean literals, not unknown names", () => {
    // HyperFormula returns #NAME? unless written TRUE(); the engine accepts the
    // Excel literal form the corpus uses, plus the reference engine's call form.
    expect(evaluate("=AND(TRUE,1)")).toBe(true);
    expect(evaluate("=FALSE")).toBe(false);
    expect(evaluate("=TRUE()")).toBe(true);
    expect(evaluate("=FALSE()")).toBe(false);
    expect(evaluate("=AND(TRUE(),1)")).toBe(true);
  });

  it("returns Date scalars for constructed dates (engine date codec)", () => {
    expect(evaluate("=DATE(2024,1,31)")).toEqual(new Date(Date.UTC(2024, 0, 31)));
  });

  it("raises typed error strings as thrown values", () => {
    expect(errorOf("=1/0")).toBe("#DIV/0!");
    expect(errorOf("=NORM.DIST(0,0,-1,TRUE)")).toBe("#NUM!");
  });

  it("formats numbers through the Excel TEXT codec", () => {
    expect(evaluate('=TEXT(1234.5,"#,##0.00")')).toBe("1,234.50");
  });

  it("spills matrix results", () => {
    expect(evaluate("=TRANSPOSE(A1:A3)")).toEqual(spill([[1, 2, 3]]));
  });
});

describe("ADR-0048 compiled-path fixes", () => {
  it("substitutes text whose pattern is an operator character", () => {
    expect(evaluate('=SUBSTITUTE("a-b-c","-","+")')).toBe("a+b+c");
    expect(evaluate('=SUBSTITUTE("a*b*c","*","+")')).toBe("a+b+c");
    expect(evaluate('=SUBSTITUTE("a(b(c","(","[")')).toBe("a[b[c");
    expect(evaluate('=SUBSTITUTE("a-b-c","-","+",2)')).toBe("a-b+c");
  });

  it("filters a range by an array comparison predicate", () => {
    expect(evaluate("=FILTER(A1:A3,A1:A3>1)")).toEqual(spill([[2], [3]]));
    expect(errorOf("=FILTER(A1:A3,A1:A3>9)")).toBe("#CALC!");
  });

  it("parses clock-time text in TIMEVALUE", () => {
    expect(evaluate('=TIMEVALUE("13:30")')).toBeCloseTo(0.5625, 12);
    expect(evaluate('=TIMEVALUE("13:30:15")')).toBeCloseTo(0.5626736111111111, 12);
    expect(evaluate('=TIMEVALUE("1:30 PM")')).toBeCloseTo(0.5625, 12);
    expect(evaluate('=TIMEVALUE("2024-01-31T13:30:00")')).toBeCloseTo(0.5625, 12);
  });
});
