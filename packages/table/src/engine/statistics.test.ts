import { beforeEach, describe, expect, it } from "vitest";
import { erfc, gammln, normalCdf, normalInverse } from "./statistics";
import { callFunction, type FunctionArg } from "./functions";
import type { Scalar } from "./types";

let cells: Record<string, Scalar> = {};
const resolve = (key: string) => cells[key] ?? null;

function call(name: string, ...args: unknown[]): Scalar | import("./spill-store").SpillMatrix {
  return callFunction(name, args as FunctionArg[], { resolve });
}

function range(from: string, to: string): FunctionArg {
  return { kind: "range", start: { address: from }, end: { address: to } };
}

beforeEach(() => {
  cells = {};
});

describe("special functions", () => {
  it("matches published constants for erfc, log-gamma and the normal CDF", () => {
    expect(erfc(1)).toBeCloseTo(0.15729920705028513, 12);
    expect(erfc(2)).toBeCloseTo(0.004677734981063239, 12);
    expect(gammln(5)).toBeCloseTo(Math.log(24), 12);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 12);
    expect(normalCdf(0)).toBe(0.5);
  });

  it("inverts the normal CDF against the published quantile", () => {
    expect(normalInverse(0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(normalInverse(0.025)).toBeCloseTo(-1.959963984540054, 9);
    expect(normalInverse(0.5)).toBeCloseTo(0, 12);
  });
});

describe("chi-squared distribution", () => {
  it("matches the closed form for two degrees of freedom", () => {
    const expected = 1 - Math.exp(-3);
    expect(call("CHISQ.DIST", 6, 2, true)).toBeCloseTo(expected, 12);
  });

  it("matches the closed form for four degrees of freedom", () => {
    const expected = 1 - 3 * Math.exp(-2);
    expect(call("CHISQ.DIST", 4, 4, true)).toBeCloseTo(expected, 12);
  });

  it("inverts against the published quantile and round-trips", () => {
    expect(call("CHISQ.INV", 0.95, 1)).toBeCloseTo(3.841458820694124, 6);
    for (const p of [0.01, 0.05, 0.5, 0.95, 0.99]) {
      const x = call("CHISQ.INV", p, 5) as number;
      expect(call("CHISQ.DIST", x, 5, true)).toBeCloseTo(p, 10);
    }
  });

  it("returns 1 when observed matches expected exactly", () => {
    cells = { A1: 5, B1: 5, A2: 10, B2: 10 };
    expect(call("CHISQ.TEST", range("A1", "B2"), range("A1", "B2"))).toBe(1);
  });

  it("returns a p-value between zero and one for a real contingency table", () => {
    cells = {
      A1: 12, B1: 8,
      A2: 5, B2: 10,
      D1: 9, E1: 9,
      D2: 9, E2: 9,
    };
    const p = call("CHISQ.TEST", range("A1", "B2"), range("D1", "E2")) as number;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.0833, 2);
  });
});

describe("student t distribution", () => {
  it("matches the Cauchy closed form at one degree of freedom", () => {
    expect(call("T.DIST", 1, 1, true)).toBeCloseTo(0.75, 12);
    expect(call("T.DIST", 2, 1, true)).toBeCloseTo(0.5 + Math.atan(2) / Math.PI, 12);
  });

  it("matches the closed form at two degrees of freedom", () => {
    expect(call("T.DIST", 1, 2, true)).toBeCloseTo(0.5 + 1 / (2 * Math.sqrt(3)), 12);
  });

  it("inverts against the published two-tailed quantile", () => {
    expect(call("T.INV.2T", 0.05, 10)).toBeCloseTo(2.2281388519649385, 6);
    expect(call("T.INV", 0.05, 10)).toBeCloseTo(-1.8124611228107335, 6);
    expect(call("T.INV", 0.95, 10)).toBeCloseTo(1.8124611228107335, 6);
  });

  it("is symmetric through the two-tailed form", () => {
    for (const p of [0.01, 0.1, 0.5, 0.9]) {
      const x = call("T.INV.2T", p, 7) as number;
      expect(call("T.DIST.2T", x, 7)).toBeCloseTo(p, 10);
    }
  });

  it("gives a half CDF at zero", () => {
    expect(call("T.DIST", 0, 5, true)).toBe(0.5);
    expect(call("T.DIST.2T", 0, 5)).toBe(1);
  });
});

describe("F distribution", () => {
  it("gives a half CDF where numerator and denominator df match", () => {
    expect(call("F.DIST", 1, 5, 5, true)).toBeCloseTo(0.5, 12);
    expect(call("F.DIST", 1, 12, 12, true)).toBeCloseTo(0.5, 11);
  });

  it("inverts against the published quantile", () => {
    expect(call("F.INV", 0.95, 3, 10)).toBeCloseTo(3.708265, 4);
  });

  it("round-trips across degrees of freedom", () => {
    for (const p of [0.05, 0.5, 0.95]) {
      for (const [d1, d2] of [[2, 9], [7, 3], [20, 20]] as const) {
        const x = call("F.INV", p, d1, d2) as number;
        expect(call("F.DIST", x, d1, d2, true)).toBeCloseTo(p, 10);
      }
    }
  });
});

describe("confidence intervals", () => {
  it("matches the normal quantile times the standard error", () => {
    expect(call("CONFIDENCE", 0.05, 1, 100)).toBeCloseTo(0.1959963984540054, 9);
    expect(call("CONFIDENCE.NORM", 0.05, 2, 100)).toBeCloseTo(0.3919927969080108, 9);
  });

  it("matches the t quantile for small samples", () => {
    const tCritical = call("T.INV.2T", 0.05, 9) as number;
    expect(call("CONFIDENCE.T", 0.05, 2, 10)).toBeCloseTo((tCritical * 2) / Math.sqrt(10), 10);
  });
});

describe("hypothesis tests", () => {
  beforeEach(() => {
    cells = {
      A1: 8, A2: 10, A3: 12, A4: 10, A5: 10,
      B1: 10, B2: 13, B3: 14, B4: 12, B5: 13,
    };
  });

  it("returns 1 for identical samples", () => {
    expect(call("T.TEST", range("A1", "A5"), range("A1", "A5"), 2, 2)).toBe(1);
  });

  it("computes a two-sample equal-variance p-value", () => {
    const p = call("T.TEST", range("A1", "A5"), range("B1", "B5"), 2, 2) as number;
    expect(p).toBeGreaterThan(0.01);
    expect(p).toBeLessThan(0.1);
  });

  it("keeps the two-tailed p at twice the one-tailed p", () => {
    const oneTail = call("T.TEST", range("A1", "A5"), range("B1", "B5"), 1, 2) as number;
    const twoTail = call("T.TEST", range("A1", "A5"), range("B1", "B5"), 2, 2) as number;
    expect(twoTail).toBeCloseTo(oneTail * 2, 12);
  });

  it("computes Welch and paired p-values without throwing", () => {
    const welch = call("T.TEST", range("A1", "A5"), range("B1", "B5"), 2, 3) as number;
    expect(welch).toBeGreaterThan(0);
    expect(welch).toBeLessThan(0.1);
    const paired = call("T.TEST", range("A1", "A5"), range("B1", "B5"), 2, 1) as number;
    expect(paired).toBeGreaterThan(0);
    expect(paired).toBeLessThan(0.01);
  });
});

describe("domain guards", () => {
  it("rejects invalid parameters with Excel error strings", () => {
    expect(() => call("NORM.DIST", 1, 0, 0, true)).toThrow("#NUM!");
    expect(() => call("NORM.S.INV", 1.5)).toThrow("#NUM!");
    expect(() => call("T.DIST", -1, 5, true)).toThrow("#NUM!");
    expect(() => call("T.DIST.2T", -1, 5)).toThrow("#NUM!");
    expect(() => call("CHISQ.DIST", -1, 5, true)).toThrow("#NUM!");
    expect(() => call("CONFIDENCE", 0, 1, 10)).toThrow("#NUM!");
  });
});
