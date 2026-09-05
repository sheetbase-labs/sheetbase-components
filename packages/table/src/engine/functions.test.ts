import { beforeEach, describe, expect, it } from "vitest";
import { callFunction, type FunctionArg } from "./functions";
import { evaluateFormula } from "./formulas";
import type { SpillMatrix } from "./spill-store";
let cells: Record<string, import("./types").Scalar> = {};
const resolve = (key: string) => cells[key] ?? null;
const ctx = { resolve };

function range(from: string, to: string): FunctionArg {
  return { kind: "range", start: { address: from }, end: { address: to } };
}

function call(name: string, ...args: unknown[]): import("./types").Scalar | import("./spill-store").SpillMatrix {
  return callFunction(name, args as FunctionArg[], ctx);
}

beforeEach(() => {
  cells = {};
});

describe("math one-liners (parity tier B1)", () => {
  it("aggregates and rounds", () => {
    cells = { A1: 2, A2: 4, A3: 8 };
    expect(call("PRODUCT", range("A1", "A3"))).toBe(64);
    expect(call("SUMSQ", range("A1", "A3"))).toBe(84);
    expect(call("MEDIAN", range("A1", "A3"))).toBe(4);
    expect(call("ROUNDUP", 1.21, 1)).toBe(1.3);
    expect(call("ROUNDDOWN", 1.29, 1)).toBe(1.2);
    expect(call("MROUND", 7, 5)).toBe(5);
    expect(call("CEILING", 7, 5)).toBe(10);
    expect(call("CEILING.MATH", -7, 5)).toBe(-5);
    expect(call("FLOOR", 7, 5)).toBe(5);
    expect(call("FLOOR.MATH", -7, 5)).toBe(-10);
    expect(call("INT", -1.5)).toBe(-2);
  });

  it("computes scientific one-liners", () => {
    expect(call("SIGN", -3)).toBe(-1);
    expect(call("POWER", 2, 10)).toBe(1024);
    expect(call("EXP", 0)).toBe(1);
    expect(call("LN", Math.E)).toBe(1);
    expect(call("LOG", 8, 2)).toBe(3);
    expect(call("LOG10", 1000)).toBe(3);
    expect(call("PI")).toBe(Math.PI);
    expect(call("SIN", 0)).toBe(0);
    expect(call("DEGREES", Math.PI)).toBe(180);
    expect(call("RADIANS", 180)).toBe(Math.PI);
    expect(call("ATAN2", 1, 1)).toBeCloseTo(Math.PI / 4, 12);
    expect(() => call("ASIN", 2)).toThrow("#NUM!");
  });

  it("computes combinatorics and bases", () => {
    expect(call("FACT", 5)).toBe(120);
    expect(call("FACTDOUBLE", 9)).toBe(945);
    expect(call("COMBIN", 10, 3)).toBe(120);
    expect(call("GCD", 24, 36)).toBe(12);
    expect(call("LCM", 4, 6)).toBe(12);
    expect(call("BASE", 255, 16)).toBe("FF");
    expect(call("DECIMAL", "FF", 16)).toBe(255);
    expect(call("ROMAN", 2026)).toBe("MMXXVI");
    expect(call("ARABIC", "MMXXVI")).toBe(2026);
  });

  it("ranks, averages geometrically and measures skew", () => {
    cells = { A1: 3, A2: 5, A3: 3, A4: 7, A5: 2 };
    expect(call("LARGE", range("A1", "A5"), 1)).toBe(7);
    expect(call("SMALL", range("A1", "A5"), 2)).toBe(3);
    expect(call("GEOMEAN", range("A1", "A5"))).toBeCloseTo(3.6297, 3);
    expect(call("HARMEAN", 1, 2, 4)).toBeCloseTo(1.7142, 3);
    expect(call("SKEW", range("A1", "A5"))).toBeCloseTo(0.9375, 3);
  });
});

describe("descriptive statistics (parity tier C, non-distribution)", () => {
  beforeEach(() => {
    cells = { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9 };
  });

  it("computes sample and population spread", () => {
    expect(call("STDEV.S", range("A1", "A8"))).toBeCloseTo(2.138, 2);
    expect(call("STDEV.P", range("A1", "A8"))).toBeCloseTo(2.0, 5);
    expect(call("VAR.S", range("A1", "A8"))).toBeCloseTo(4.571, 2);
    expect(call("VAR.P", range("A1", "A8"))).toBe(4);
  });

  it("computes correlation-style pairs and percentiles", () => {
    cells = { A1: 2, A2: 4, B1: 20, B2: 40 };
    expect(call("CORREL", range("A1", "A2"), range("B1", "B2"))).toBe(1);
    expect(call("PEARSON", range("A1", "A2"), range("B1", "B2"))).toBe(1);
    expect(call("RSQ", range("A1", "A2"), range("B1", "B2"))).toBe(1);
    expect(call("COVARIANCE.P", range("A1", "A2"), range("B1", "B2"))).toBe(10);
    cells = { A1: 1, A2: 2, A3: 3, A4: 4 };
    expect(call("PERCENTILE.INC", range("A1", "A4"), 0.75)).toBe(3.25);
    expect(call("QUARTILE.INC", range("A1", "A4"), 1)).toBe(1.75);
  });
});

describe("criteria aggregation (parity tier B2)", () => {
  beforeEach(() => {
    cells = {
      A1: "Control", B1: 10,
      A2: "5% sucrose", B2: 20,
      A3: "Control", B3: 30,
      A4: "5% sucrose", B4: 40,
    };
  });

  it("conditionally sums, averages and counts", () => {
    expect(call("SUMIF", range("A1", "A4"), "Control", range("B1", "B4"))).toBe(40);
    expect(call("AVERAGEIF", range("A1", "A4"), "Control", range("B1", "B4"))).toBe(20);
    expect(call("COUNTIF", range("A1", "A4"), "Control")).toBe(2);
    expect(call("SUMIF", range("B1", "B4"), ">25")).toBe(70);
  });

  it("supports multi-criteria ifs and products", () => {
    cells = {
      A1: "Control", B1: 10, C1: 1,
      A2: "Control", B2: 20, C2: 2,
      A3: "5% sucrose", B3: 30, C3: 3,
    };
    expect(
      call("SUMIFS", range("B1", "B3"), range("A1", "A3"), "Control", range("C1", "C3"), 1),
    ).toBe(10);
    expect(call("COUNTIFS", range("A1", "A3"), "Control")).toBe(2);
    expect(call("SUMPRODUCT", range("B1", "B3"), range("C1", "C3"))).toBe(10 + 40 + 90);
  });

  it("supports wildcards and comparison criteria", () => {
    cells = { A1: "5% sucrose", A2: "5% trehalose" };
    expect(call("COUNTIF", range("A1", "A2"), "5% *")).toBe(2);
    cells = { A1: 10, A2: 20, A3: 30 };
    expect(call("SUMIF", range("A1", "A3"), ">15")).toBe(50);
  });

  it("computes series sums and subtotals", () => {
    cells = { A1: 2, A2: 3, A3: 4 };
    expect(call("SERIESSUM", 2, 0, 1, range("A1", "A3"))).toBe(2 + 6 + 16);
    expect(call("SUBTOTAL", 9, range("A1", "A3"))).toBe(9);
    expect(call("SUBTOTAL", 1, range("A1", "A3"))).toBe(3);
    expect(call("SUBTOTAL", 4, range("A1", "A3"))).toBe(4);
  });
});

describe("text functions (parity tier B3)", () => {
  it("slices and transforms text", () => {
    expect(call("LEFT", "virus study", 5)).toBe("virus");
    expect(call("RIGHT", "virus study", 5)).toBe("study");
    expect(call("MID", "virus study", 7, 5)).toBe("study");
    expect(call("LEN", "virus")).toBe(5);
    expect(call("UPPER", "virus")).toBe("VIRUS");
    expect(call("LOWER", "VIRUS")).toBe("virus");
    expect(call("PROPER", "virus STUDY")).toBe("Virus Study");
    expect(call("TRIM", "  spaced   out  ")).toBe("spaced out");
    expect(call("CLEAN", "a\u0007b")).toBe("ab");
    expect(call("REPT", "ab", 3)).toBe("ababab");
    expect(call("CONCATENATE", "a", "b", 1)).toBe("ab1");
    expect(call("TEXTJOIN", "-", true, "a", "", "b")).toBe("a-b");
  });

  it("finds, replaces, substitutes and formats", () => {
    expect(call("FIND", "s", "virus")).toBe(5);
    expect(call("SEARCH", "S", "virus")).toBe(5);
    expect(() => call("FIND", "z", "virus")).toThrow("#VALUE!");
    expect(call("REPLACE", "abcdef", 2, 3, "X")).toBe("aXef");
    expect(call("SUBSTITUTE", "a-b-c", "-", "+")).toBe("a+b+c");
    expect(call("SUBSTITUTE", "a-b-c", "-", "+", 2)).toBe("a-b+c");
    expect(call("VALUE", "1,200")).toBe(1200);
    expect(call("VALUE", "50%")).toBe(0.5);
    expect(call("TEXT", 1234.5, "#,##0.00")).toBe("1,234.50");
  });
});

describe("date and time functions (parity tier B4)", () => {
  it("extracts parts and builds times", () => {
    cells = { A1: "2026-08-28T14:30:45Z" };
    const date = call("DATEVALUE", "2026-08-28") as Date;
    expect(date.getUTCFullYear()).toBe(2026);
    expect(call("HOUR", "2026-08-28T14:30:45Z")).toBe(14);
    expect(call("MINUTE", "2026-08-28T14:30:45Z")).toBe(30);
    expect(call("SECOND", "2026-08-28T14:30:45Z")).toBe(45);
    expect(call("TIME", 14, 30, 45)).toBeCloseTo(14.5125 / 24, 6);
    expect(call("TIMEVALUE", "2026-08-28T14:30:45Z")).toBeCloseTo(14.5125 / 24, 6);
    void date;
  });

  it("shifts months, weeks and working days", () => {
    expect((call("EDATE", "2026-01-31", 1) as Date).getUTCMonth()).toBe(1);
    expect((call("EOMONTH", "2026-01-15", 1) as Date).getUTCDate()).toBe(28);
    expect(call("WEEKDAY", "2026-09-03")).toBe(5);
    expect(call("ISOWEEKNUM", "2026-01-01")).toBe(1);
    expect(call("NETWORKDAYS", "2026-08-24", "2026-08-30")).toBe(5);
    expect((call("WORKDAY", "2026-01-07", 5) as Date).getUTCDate()).toBe(14);
    expect(call("DATEDIF", "2020-01-15", "2023-03-15", "Y")).toBe(3);
    expect(call("DATEDIF", "2020-01-15", "2023-03-15", "M")).toBe(38);
    expect(call("DATEDIF", "2020-01-15", "2023-03-15", "D")).toBe(1155);
  });
});

describe("lookup, information and error functions (parity tier D)", () => {
  beforeEach(() => {
    cells = {
      A1: "Control", B1: 10,
      A2: "5% sucrose", B2: 20,
      A3: "Control", B3: 30,
    };
  });

  it("looks up vertically, horizontally and by position", () => {
    expect(call("VLOOKUP", "5% sucrose", range("A1", "B3"), 2)).toBe(20);
    expect(call("VLOOKUP", "missing", range("A1", "B3"), 2)).toBe("#N/A");
    cells = { A1: 10, B1: 20, A2: 30, B2: 40 };
    expect(call("HLOOKUP", 20, range("A1", "B2"), 1)).toBe(20);
    expect(call("HLOOKUP", 20, range("A1", "B2"), 2)).toBe(40);
    expect(call("INDEX", range("A1", "B2"), 2, 2)).toBe(40);
    expect(call("INDEX", range("A1", "A2"), 2)).toBe(30);
    expect(call("CHOOSE", 2, "a", "b", "c")).toBe("b");
    expect(call("ROWS", range("A1", "B3"))).toBe(3);
    expect(call("COLUMNS", range("A1", "B3"))).toBe(2);
    expect(call("ADDRESS", 3, 2)).toBe("$B$3");
  });

  it("transposes and filters as spills", () => {
    cells = {
      A1: 10, B1: 20,
      A2: 30, B2: 40,
    };
    const transposed = call("TRANSPOSE", range("A1", "B2")) as SpillMatrix;
    expect(transposed.values).toEqual([[10, 30], [20, 40]]);
    cells = {
      A1: "keep", B1: true,
      A2: "drop", B2: false,
      A3: "keep", B3: true,
    };
    const filtered = call("FILTER", range("A1", "B3"), range("B1", "B3")) as SpillMatrix;
    expect(filtered.values).toEqual([["keep", true], ["keep", true]]);
    cells = { B1: false, B2: false, B3: false };
    expect(call("FILTER", range("A1", "B3"), range("B1", "B3"), "none")).toBe("none");
  });

  it("classifies values", () => {
    cells = { A1: 1.5, A2: "text", A3: true };
    expect(call("ISNUMBER", 1.5)).toBe(true);
    expect(call("ISTEXT", "s")).toBe(true);
    expect(call("ISLOGICAL", true)).toBe(true);
    expect(call("ISNONTEXT", 1)).toBe(true);
    expect(call("ISBLANK", null)).toBe(true);
    expect(call("ISREF", range("A1", "A2"))).toBe(false);
    expect(call("N", 5)).toBe(5);
    expect(call("N", true)).toBe(1);
    expect(call("N", "x")).toBe(0);
    expect(call("NA")).toBe("#N/A");
    expect(call("ISNA", "#N/A")).toBe(true);
    expect(call("ISODD", 3)).toBe(true);
    expect(call("ISEVEN", 2)).toBe(true);
    expect(call("XOR", true, true, true)).toBe(true);
    expect(call("XOR", true, true)).toBe(false);
  });

  it("switches on the first matching case", () => {
    expect(call("SWITCH", "b", "a", 1, "b", 2, 99)).toBe(2);
    expect(call("SWITCH", "z", "a", 1, 99)).toBe(99);
    expect(() => call("SWITCH", "z", "a", 1)).toThrow("#N/A");
  });
});

describe("lazy error guards", () => {
  it("IFERROR falls back only when the value errors", () => {
    expect(evaluateFormula('=IFERROR(1/0, "safe")', resolve)).toBe("safe");
    expect(evaluateFormula('=IFERROR(5, "safe")', resolve)).toBe(5);
  });

  it("IFNA substitutes only #N/A results", () => {
    expect(evaluateFormula('=IFNA(XLOOKUP("z", A1:A2, A1:A2), "fallback")', resolve)).toBe("fallback");
    cells = { A1: 1, A2: 2 };
    expect(evaluateFormula('=IFNA(XLOOKUP(1, A1:A2, A1:A2), "fallback")', resolve)).toBe(1);
  });

  it("ISERROR reports errors without throwing", () => {
    expect(evaluateFormula("=ISERROR(1/0)", resolve)).toBe(true);
    expect(evaluateFormula("=ISERROR(4)", resolve)).toBe(false);
  });

  it("IFS picks the first matching pair", () => {
    expect(evaluateFormula("=IFS(FALSE, 1, TRUE, 2, TRUE, 3)", resolve)).toBe(2);
    expect(() => evaluateFormula("=IFS(FALSE, 1)", resolve)).toThrow();
  });

  it("IFERROR works through the bytecode pipeline on the grid", () => {
    cells = { A1: 4, A2: 0 };
    expect(evaluateFormula('=IFERROR(A1/A2, "divided by zero")', resolve)).toBe("divided by zero");
    expect(evaluateFormula("=A1/A1", resolve)).toBe(1);
  });
});

describe("demo tryout surface (every formula suggested to users)", () => {
  const assays = {
    C1: "p24 ELISA", C2: "Residual DNA", C3: "Vector ID", C4: "BCA",
    C5: "HCP", C6: "PicoGreen", C7: "Benzonase", C8: "p24 ELISA",
  };
  const results = { D1: 18.42, D2: 0.034, D3: 29.18, D4: 1.72, D5: 8.91, D6: 12.04, D7: 0.18, D8: 21.09 };
  const samples = { B1: "SMP-2084", B2: "SMP-2087", B3: "SMP-2091", B4: "SMP-2096", B5: "SMP-2102", B6: "SMP-2107", B7: "SMP-2110", B8: "SMP-2114" };
  const statuses = { G1: "Complete", G2: "Complete", G3: "Review", G4: "Complete", G5: "Flagged", G6: "Complete", G7: "Review", G8: "Complete" };

  it("spills UNIQUE assays and SEQUENCE blocks", () => {
    cells = { ...assays };
    const unique = call("UNIQUE", range("C1", "C8")) as SpillMatrix;
    expect(unique.values).toEqual([["p24 ELISA"], ["Residual DNA"], ["Vector ID"], ["BCA"], ["HCP"], ["PicoGreen"], ["Benzonase"]]);
    const block = call("SEQUENCE", 4, 4, 10, 10) as SpillMatrix;
    expect(block.values).toEqual([[10, 20, 30, 40], [50, 60, 70, 80], [90, 100, 110, 120], [130, 140, 150, 160]]);
  });

  it("sorts results both directions and orders samples by result", () => {
    cells = { ...results, ...samples };
    const ascending = call("SORT", range("D1", "D8")) as SpillMatrix;
    expect(ascending.values.flat()).toEqual([0.034, 0.18, 1.72, 8.91, 12.04, 18.42, 21.09, 29.18]);
    const descending = call("SORT", range("D1", "D8"), 1, 0) as SpillMatrix;
    expect(descending.values.flat()).toEqual([29.18, 21.09, 18.42, 12.04, 8.91, 1.72, 0.18, 0.034]);
    const byResult = call("SORTBY", range("B1", "B8"), range("D1", "D8"), -1) as SpillMatrix;
    expect(byResult.values.flat()[0]).toBe("SMP-2091");
    expect(byResult.values.flat().at(-1)).toBe("SMP-2087");
  });

  it("looks up across the demo dataset", () => {
    cells = { ...assays, ...results, ...samples, ...statuses };
    expect(call("XLOOKUP", "p24 ELISA", range("C1", "C8"), range("D1", "D8"))).toBe(18.42);
    expect(call("XLOOKUP", "p24*", range("C1", "C8"), range("D1", "D8"), "none", 2)).toBe(18.42);
    expect(call("XLOOKUP", "zzz", range("C1", "C8"), range("D1", "D8"), "not found")).toBe("not found");
    expect(call("MATCH", "BCA", range("C1", "C8"), 0)).toBe(4);
    expect(call("INDEX", range("B1", "B8"), 3)).toBe("SMP-2091");
    expect(evaluateFormula('=IFNA(XLOOKUP("zzz",C1:C8,D1:D8),"not found")', resolve)).toBe("not found");
  });

  it("aggregates and joins the demo dataset", () => {
    cells = { ...results, ...statuses, ...assays };
    expect(call("SUMIFS", range("D1", "D8"), range("G1", "G8"), "Complete")).toBeCloseTo(18.42 + 0.034 + 1.72 + 12.04 + 21.09, 9);
    expect(call("COUNTIF", range("G1", "G8"), "Review")).toBe(2);
    expect(call("MEDIAN", range("D1", "D8"))).toBe((8.91 + 12.04) / 2);
    expect(call("TEXTJOIN", ", ", true, range("C1", "C3"))).toBe("p24 ELISA, Residual DNA, Vector ID");
    expect(call("SWITCH", "Complete", "Complete", "done", "Review", "pending", "other")).toBe("done");
  });

  it("computes workdays, month ends and volatile draws", () => {
    cells = { F1: "2026-08-31", F8: "2026-09-04" };
    expect(call("EOMONTH", "2026-08-28", 1)).toEqual(new Date(Date.UTC(2026, 8, 30)));
    const week = call("WEEKNUM", "2026-09-04") as number;
    expect(week).toBeGreaterThanOrEqual(1);
    expect(call("NETWORKDAYS", "2026-08-31", "2026-09-04")).toBe(5);
    const draw = call("RAND") as number;
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
    for (let roll = 0; roll < 20; roll++) {
      const pick = call("RANDBETWEEN", 1, 100) as number;
      expect(Number.isInteger(pick)).toBe(true);
      expect(pick).toBeGreaterThanOrEqual(1);
      expect(pick).toBeLessThanOrEqual(100);
    }
  });
});


describe("vendored parity sweep (every implementation has a direct test)", () => {
  it("covers the core aggregates", () => {
    cells = { A1: 2, A2: "4", A3: "x" };
    expect(call("SUM", 1, 2, 3)).toBe(6);
    expect(call("SUM", "5")).toBe(5);
    expect(() => call("SUM", "x")).toThrow("#VALUE!");
    expect(call("SUM", range("A1", "A3"))).toBe(2);
    expect(call("AVERAGE", 2, 4, 6)).toBe(4);
    expect(call("MIN", range("A1", "A3"))).toBe(2);
    expect(call("MAX", range("A1", "A3"))).toBe(2);
    expect(call("COUNT", range("A1", "A3"))).toBe(2);
    expect(call("COUNTA", range("A1", "A3"))).toBe(3);
  });

  it("covers date construction and parts", () => {
    const built = call("DATE", 2026, 9, 4) as Date;
    expect(built).toEqual(new Date(Date.UTC(2026, 8, 4)));
    expect(call("YEAR", built)).toBe(2026);
    expect(call("MONTH", built)).toBe(9);
    expect(call("DAY", built)).toBe(4);
  });

  it("covers scalar math and trig", () => {
    expect(call("ABS", -3)).toBe(3);
    expect(call("SQRT", 16)).toBe(4);
    expect(() => call("SQRT", -1)).toThrow("#NUM!");
    expect(call("MOD", 7, 3)).toBe(1);
    expect(call("TRUNC", -1.9)).toBe(-1);
    expect(call("ROUND", 2.5, 0)).toBe(3);
    expect(call("COS", 0)).toBe(1);
    expect(call("TAN", 0)).toBe(0);
    expect(call("ACOS", 1)).toBe(0);
    expect(call("ATAN", 1)).toBeCloseTo(Math.PI / 4, 12);
  });

  it("covers deviation and variance aliases", () => {
    cells = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };
    expect(call("STDEV", range("A1", "A5"))).toBeCloseTo(Math.sqrt(2.5), 9);
    expect(call("STDEVA", range("A1", "A5"))).toBeCloseTo(Math.sqrt(2.5), 9);
    expect(call("STDEVP", range("A1", "A5"))).toBeCloseTo(Math.SQRT2, 9);
    expect(call("VAR", range("A1", "A5"))).toBeCloseTo(2.5, 9);
    expect(call("VARA", range("A1", "A5"))).toBeCloseTo(2.5, 9);
    expect(call("VARP", range("A1", "A5"))).toBeCloseTo(2, 9);
    expect(call("VARPA", 1, 2, 3)).toBeCloseTo(2 / 3, 9);
    expect(call("SKEW.P", range("A1", "A5"))).toBeCloseTo(0, 9);
  });

  it("covers covariance, percentiles and quartiles", () => {
    cells = { A1: 1, A2: 2, A3: 3, B1: 2, B2: 4, B3: 6 };
    expect(call("COVARIANCE.S", range("A1", "A3"), range("B1", "B3"))).toBeCloseTo(2, 9);
    cells = { A1: 0, A2: 100 };
    expect(call("PERCENTILE", range("A1", "A2"), 0.5)).toBe(50);
    expect(call("PERCENTILE.EXC", range("A1", "A2"), 0.5)).toBe(50);
    cells = { A1: 1, A2: 2, A3: 3, A4: 4 };
    expect(call("QUARTILE", range("A1", "A4"), 2)).toBe(2.5);
    cells = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };
    expect(call("QUARTILE.EXC", range("A1", "A5"), 2)).toBe(3);
  });

  it("covers multi-criteria averaging and confidence smoke", () => {
    cells = { A1: "x", B1: 10, A2: "y", B2: 20, A3: "x", B3: 30 };
    expect(call("AVERAGEIFS", range("B1", "B3"), range("A1", "A3"), "x")).toBe(20);
    const interval = call("CONFIDENCE", 0.05, 2, 100) as number;
    expect(interval).toBeGreaterThan(0.3);
    expect(interval).toBeLessThan(0.5);
  });
});

describe("remaining logical and volatile names", () => {
  it("branches on the first true condition", () => {
    expect(call("IFS", false, "no", true, "yes")).toBe("yes");
    expect(() => call("IFS", false, "no")).toThrow("#N/A");
  });

  it("returns real dates for volatile clocks", () => {
    const today = call("TODAY") as Date;
    expect(today).toBeInstanceOf(Date);
    const now = call("NOW") as Date;
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(today.getTime());
  });
});

describe("conjunctions", () => {
  it("ands, ors and negates", () => {
    expect(call("AND", true, true)).toBe(true);
    expect(call("AND", true, false)).toBe(false);
    expect(call("AND")).toBe(true);
    expect(call("OR", false, false)).toBe(false);
    expect(call("OR", false, true)).toBe(true);
    expect(call("OR")).toBe(false);
    expect(call("NOT", false)).toBe(true);
    expect(call("NOT", true)).toBe(false);
    cells = { A1: true, A2: false, A3: null };
    expect(call("AND", range("A1", "A3"))).toBe(false);
    expect(call("OR", range("A1", "A3"))).toBe(true);
  });
});

describe("tokenizer function disambiguation", () => {
  it("reads digit-suffixed names as calls, not cells", () => {
    cells = { LOG10: 999 };
    expect(evaluateFormula("=LOG10(1000)", resolve)).toBe(3);
    expect(evaluateFormula("=LOG10+A1", resolve)).toBe(999);
  });
});
