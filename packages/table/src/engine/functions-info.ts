import type { FunctionImpl } from "./functions-runtime";
import {
  betaI,
  chiSquaredCdf,
  chiSquaredPdf,
  fCdf,
  fPdf,
  gammaQ,
  invertIncreasing,
  normalCdf,
  normalInverse,
  tCdf,
  tPdf,
  sampleSummary,
} from "./statistics";
import {
  boolean,
  confidenceNormal,
  flatten,
  leftTailTInverse,
  matrixOf,
  number,
  scalarOf,
  twoTailTInverse,
} from "./functions-runtime";

export const INFO_FUNCTIONS: Record<string, FunctionImpl> = {
  // --- information / error (lazy ones are compiler-special-cased) ---
  NA: () => "#N/A",
  ISBLANK: (args) => scalarOf(args[0]) === null,
  ISNA: (args) => scalarOf(args[0]) === "#N/A",
  ISNUMBER: (args) => typeof scalarOf(args[0]) === "number",
  ISTEXT: (args) => typeof scalarOf(args[0]) === "string",
  ISNONTEXT: (args) => typeof scalarOf(args[0]) !== "string",
  ISLOGICAL: (args) => typeof scalarOf(args[0]) === "boolean",
  ISODD: (args) => Math.abs(Math.trunc(number(scalarOf(args[0])))) % 2 === 1,
  ISEVEN: (args) => Math.abs(Math.trunc(number(scalarOf(args[0])))) % 2 === 0,
  ISREF: () => false,
  N: (args) => {
    const value = scalarOf(args[0]);
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return 0;
  },

  // --- distributions and tests (parity tier C numerics) ---
  'NORM.S.DIST': (args) => {
    const z = number(scalarOf(args[0]));
    const cumulative = args[1] === undefined ? true : boolean(scalarOf(args[1]));
    return cumulative
      ? normalCdf(z)
      : Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
  },
  'NORM.S.INV': (args) => normalInverse(number(scalarOf(args[0]))),
  'NORM.DIST': (args) => {
    const x = number(scalarOf(args[0]));
    const mean = number(scalarOf(args[1]));
    const sd = number(scalarOf(args[2]));
    if (sd <= 0) throw new Error("#NUM!");
    const cumulative = args[3] === undefined ? true : boolean(scalarOf(args[3]));
    const z = (x - mean) / sd;
    return cumulative
      ? normalCdf(z)
      : Math.exp(-(z * z) / 2) / (sd * Math.sqrt(2 * Math.PI));
  },
  'NORM.INV': (args) => {
    const p = number(scalarOf(args[0]));
    const mean = number(scalarOf(args[1]));
    const sd = number(scalarOf(args[2]));
    if (sd <= 0) throw new Error("#NUM!");
    return normalInverse(p) * sd + mean;
  },
  'CHISQ.DIST': (args) => {
    const x = number(scalarOf(args[0]));
    const degreesOfFreedom = number(scalarOf(args[1]));
    const cumulative = args[2] === undefined ? true : boolean(scalarOf(args[2]));
    if (degreesOfFreedom <= 0) throw new Error("#NUM!");
    return cumulative ? chiSquaredCdf(x, degreesOfFreedom) : chiSquaredPdf(x, degreesOfFreedom);
  },
  'CHISQ.INV': (args) => {
    const probability = number(scalarOf(args[0]));
    const degreesOfFreedom = number(scalarOf(args[1]));
    if (degreesOfFreedom <= 0) throw new Error("#NUM!");
    return invertIncreasing(
      (x) => chiSquaredCdf(x, degreesOfFreedom),
      probability,
    );
  },
  'CHISQ.TEST': (args, ctx) => {
    const actual = matrixOf(args[0], ctx);
    const expected = matrixOf(args[1], ctx);
    if (actual.length !== expected.length || (actual[0]?.length ?? 0) !== (expected[0]?.length ?? 0)) {
      throw new Error("#N/A");
    }
    let statistic = 0;
    let cells = 0;
    for (let row = 0; row < actual.length; row++) {
      for (let column = 0; column < (actual[row]?.length ?? 0); column++) {
        const observed = number(actual[row][column]);
        const theoretical = number(expected[row][column]);
        if (theoretical === 0) throw new Error("#DIV/0!");
        statistic += (observed - theoretical) ** 2 / theoretical;
        cells += 1;
      }
    }
    const degreesOfFreedom = Math.max(1, (actual.length - 1) * ((actual[0]?.length ?? 1) - 1));
    void cells;
    return gammaQ(degreesOfFreedom / 2, statistic / 2);
  },
  'F.DIST': (args) => {
    const x = number(scalarOf(args[0]));
    const d1 = number(scalarOf(args[1]));
    const d2 = number(scalarOf(args[2]));
    const cumulative = args[3] === undefined ? true : boolean(scalarOf(args[3]));
    if (d1 <= 0 || d2 <= 0) throw new Error("#NUM!");
    return cumulative ? fCdf(x, d1, d2) : fPdf(x, d1, d2);
  },
  'F.INV': (args) => {
    const probability = number(scalarOf(args[0]));
    const d1 = number(scalarOf(args[1]));
    const d2 = number(scalarOf(args[2]));
    if (d1 <= 0 || d2 <= 0) throw new Error("#NUM!");
    return invertIncreasing((x) => fCdf(x, d1, d2), probability);
  },
  'F.TEST': (args, ctx) => {
    const first = flatten(args[0], ctx).filter((value) => value !== null).map(number);
    const second = flatten(args[1], ctx).filter((value) => value !== null).map(number);
    const summaryFirst = sampleSummary(first);
    const summarySecond = sampleSummary(second);
    const numerator = Math.max(summaryFirst.variance, summarySecond.variance);
    const denominator = Math.min(summaryFirst.variance, summarySecond.variance);
    if (denominator === 0) throw new Error("#DIV/0!");
    const statistic = numerator / denominator;
    const numeratorDf = (summaryFirst.variance >= summarySecond.variance ? summaryFirst.count : summarySecond.count) - 1;
    const denominatorDf = (summaryFirst.variance >= summarySecond.variance ? summarySecond.count : summaryFirst.count) - 1;
    return 2 * (1 - fCdf(statistic, numeratorDf, denominatorDf));
  },
  'T.DIST': (args) => {
    const x = number(scalarOf(args[0]));
    const degreesOfFreedom = number(scalarOf(args[1]));
    const cumulative = args[2] === undefined ? true : boolean(scalarOf(args[2]));
    if (degreesOfFreedom <= 0 || x < 0) throw new Error("#NUM!");
    return cumulative ? tCdf(x, degreesOfFreedom) : tPdf(x, degreesOfFreedom);
  },
  'T.DIST.2T': (args) => {
    const x = number(scalarOf(args[0]));
    const degreesOfFreedom = number(scalarOf(args[1]));
    if (degreesOfFreedom <= 0 || x < 0) throw new Error("#NUM!");
    return betaI(degreesOfFreedom / 2, 0.5, degreesOfFreedom / (degreesOfFreedom + x * x));
  },
  'T.INV': (args) => leftTailTInverse(number(scalarOf(args[0])), number(scalarOf(args[1]))),
  'T.INV.2T': (args) => twoTailTInverse(number(scalarOf(args[0])), number(scalarOf(args[1]))),
  'T.TEST': (args, ctx) => {
    const tails = args[2] === undefined ? 2 : Math.trunc(number(scalarOf(args[2])));
    const type = args[3] === undefined ? 2 : Math.trunc(number(scalarOf(args[3])));
    if (tails !== 1 && tails !== 2) throw new Error("#NUM!");
    const first = flatten(args[0], ctx).filter((value) => value !== null).map(number);
    const second = flatten(args[1], ctx).filter((value) => value !== null).map(number);
    let statistic: number;
    let degreesOfFreedom: number;
    if (type === 1) {
      if (first.length !== second.length || first.length < 2) throw new Error("#DIV/0!");
      const differences = first.map((value, index) => value - second[index]);
      const mean = differences.reduce((total, value) => total + value, 0) / differences.length;
      const sd = Math.sqrt(
        differences.reduce((total, value) => total + (value - mean) ** 2, 0) / (differences.length - 1),
      );
      statistic = mean / (sd / Math.sqrt(differences.length));
      degreesOfFreedom = differences.length - 1;
    } else if (type === 2 || type === 3) {
      const summaryFirst = sampleSummary(first);
      const summarySecond = sampleSummary(second);
      if (type === 2) {
        const pooled = ((summaryFirst.count - 1) * summaryFirst.variance + (summarySecond.count - 1) * summarySecond.variance) /
          (summaryFirst.count + summarySecond.count - 2);
        statistic = (summaryFirst.mean - summarySecond.mean) /
          Math.sqrt(pooled * (1 / summaryFirst.count + 1 / summarySecond.count));
        degreesOfFreedom = summaryFirst.count + summarySecond.count - 2;
      } else {
        const varianceTerm = summaryFirst.variance / summaryFirst.count + summarySecond.variance / summarySecond.count;
        statistic = (summaryFirst.mean - summarySecond.mean) / Math.sqrt(varianceTerm);
        degreesOfFreedom = Math.max(
          1,
          Math.trunc(
            varianceTerm ** 2 /
              (summaryFirst.variance ** 2 / (summaryFirst.count ** 2 * (summaryFirst.count - 1)) +
                summarySecond.variance ** 2 / (summarySecond.count ** 2 * (summarySecond.count - 1))),
          ),
        );
      }
    } else {
      throw new Error("#NUM!");
    }
    const oneTail = 1 - tCdf(Math.abs(statistic), degreesOfFreedom);
    return tails === 1 ? oneTail : oneTail * 2;
  },
  CONFIDENCE: (args) => confidenceNormal(args),
  'CONFIDENCE.NORM': (args) => confidenceNormal(args),
  'CONFIDENCE.T': (args) => {
    const alpha = number(scalarOf(args[0]));
    const sd = number(scalarOf(args[1]));
    const size = Math.trunc(number(scalarOf(args[2])));
    if (alpha <= 0 || alpha >= 1 || sd <= 0 || size < 2) throw new Error("#NUM!");
    return twoTailTInverse(alpha, size - 1) * (sd / Math.sqrt(size));
  },

};
