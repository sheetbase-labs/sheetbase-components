import type { Scalar } from "./types";
import type { FunctionImpl } from "./functions-runtime";
import {
  aggregateNumbers,
  arabicNumeral,
  asDate,
  boolean,
  correlation,
  covariance,
  flatten,
  matchesCriteria,
  matrixOf,
  matrixPair,
  number,
  percentile,
  romanNumeral,
  sample,
  sampleA,
  scalarOf,
  skewness,
  stdev,
  text,
  throwNumeric,
  trimNumeric,
} from "./functions-runtime";

export const CORE_FUNCTIONS: Record<string, FunctionImpl> = {
  // --- logical ---
  IFNA: (args) => {
    const value = scalarOf(args[0]);
    return value === "#N/A" ? scalarOf(args[1] ?? null) : value;
  },
  IFS: (args) => {
    for (let index = 0; index + 1 < args.length; index += 2) {
      if (boolean(scalarOf(args[index]))) return scalarOf(args[index + 1]);
    }
    throw new Error("#N/A");
  },
  AND: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    return flat.every((value) => value === null || value === "" || boolean(value));
  },
  OR: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    return flat.some((value) => value !== null && value !== "" && boolean(value));
  },
  NOT: (args) => !boolean(scalarOf(args[0])),
  XOR: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    let truthy = 0;
    for (const value of flat) if (boolean(value)) truthy += 1;
    return truthy % 2 === 1;
  },
  SWITCH: (args, _ctx) => {
    const expression = scalarOf(args[0]);
    for (let index = 1; index + 1 < args.length; index += 2) {
      if (matchesCriteria(expression, scalarOf(args[index]))) return scalarOf(args[index + 1]);
    }
    if (args.length % 2 === 0) return scalarOf(args[args.length - 1]);
    throw new Error("#N/A");
  },

  // --- core (original engine surface) ---
  SUM: (args, ctx) => aggregateNumbers(args, ctx).reduce((total, value) => total + value, 0),
  AVERAGE: (args, ctx) => {
    const values = aggregateNumbers(args, ctx);
    if (values.length === 0) throw new Error("#DIV/0!");
    return values.reduce((total, value) => total + value, 0) / values.length;
  },
  MIN: (args, ctx) => {
    const values = aggregateNumbers(args, ctx);
    return values.length === 0 ? 0 : Math.min(...values);
  },
  MAX: (args, ctx) => {
    const values = aggregateNumbers(args, ctx);
    return values.length === 0 ? 0 : Math.max(...values);
  },
  COUNT: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    let total = 0;
    for (const value of flat) if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) total += 1;
    return total;
  },
  COUNTA: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    let total = 0;
    for (const value of flat) if (value !== null && value !== "") total += 1;
    return total;
  },
  SEQUENCE: (args) => {
    const rows = Math.trunc(number(scalarOf(args[0])));
    const columns = args[1] === undefined ? 1 : Math.trunc(number(scalarOf(args[1])));
    const start = args[2] === undefined ? 1 : number(scalarOf(args[2]));
    const step = args[3] === undefined ? 1 : number(scalarOf(args[3]));
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) throw new Error("#VALUE!");
    return {
      kind: "spill",
      values: Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => start + (row * columns + column) * step),
      ),
    };
  },
  XLOOKUP: (args, ctx) => {
    const lookup = scalarOf(args[0]);
    const lookupValues = flatten(args[1], ctx);
    const returnValues = flatten(args[2], ctx);
    const ifNotFound = args[3] !== undefined ? scalarOf(args[3]) : "#N/A";
    const matchMode = args[4] === undefined ? 0 : Math.trunc(number(scalarOf(args[4])));
    const searchMode = args[5] === undefined ? 1 : Math.trunc(number(scalarOf(args[5])));
    const matches = (value: Scalar) =>
      matchMode === 2 && typeof lookup === "string"
        ? matchesCriteria(value, lookup)
        : value === lookup;
    const order = searchMode === -1 ? [...lookupValues.keys()].reverse() : [...lookupValues.keys()];
    for (const index of order) {
      if (matches(lookupValues[index])) return returnValues[index] ?? null;
    }
    return ifNotFound;
  },
  MATCH: (args, ctx) => {
    const lookup = scalarOf(args[0]);
    const values = flatten(args[1], ctx);
    const matchType = args[2] === undefined ? 0 : Math.trunc(number(scalarOf(args[2])));
    const hasWildcard = typeof lookup === "string" && (lookup.includes("*") || lookup.includes("?"));
    if (matchType === 1) {
      let best = -1;
      values.forEach((value, index) => {
        if (typeof value === "number" && typeof lookup === "number" && value <= lookup) best = index;
      });
      return best >= 0 ? best + 1 : "#N/A";
    }
    if (matchType === -1) {
      let best = -1;
      values.forEach((value, index) => {
        if (typeof value === "number" && typeof lookup === "number" && value >= lookup) best = index;
      });
      return best >= 0 ? best + 1 : "#N/A";
    }
    const index = values.findIndex((value) => (hasWildcard && typeof lookup === "string" ? matchesCriteria(value, lookup) : value === lookup));
    return index >= 0 ? index + 1 : "#N/A";
  },
  UNIQUE: (args, ctx) => {
    const rows = matrixOf(args[0], ctx);
    if (rows.length === 0 || rows.every((row) => row.length === 0)) throw new Error("#CALC!");
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      const fingerprint = JSON.stringify(row);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
    if (unique.length === 0) throw new Error("#CALC!");
    return { kind: "spill", values: unique.map((row) => [...row]) };
  },
  SORT: (args, ctx) => {
    const rows = matrixOf(args[0], ctx).map((row) => [...row]);
    const column = args[1] === undefined ? 1 : Math.trunc(number(scalarOf(args[1])));
    const ascending = args[2] === undefined ? true : number(scalarOf(args[2])) > 0;
    if (!Number.isInteger(column) || column < 1 || rows.some((row) => column > row.length)) throw new Error("#VALUE!");
    const rank = (value: Scalar) => (typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2);
    rows.sort((left, right) => {
      const leftValue = left[column - 1];
      const rightValue = right[column - 1];
      let order = rank(leftValue) - rank(rightValue);
      if (order === 0) {
        order = typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : text(leftValue).localeCompare(text(rightValue));
      }
      return ascending ? order : -order;
    });
    return { kind: "spill", values: rows };
  },
  SORTBY: (args, ctx) => {
    const rows = matrixOf(args[0], ctx).map((row) => [...row]);
    const keys = flatten(args[1], ctx);
    const ascending = args[2] === undefined ? true : number(scalarOf(args[2])) > 0;
    if (keys.length !== rows.length) throw new Error("#VALUE!");
    const rank = (value: Scalar) => (typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2);
    const indexed = rows.map((row, index) => ({ row, key: keys[index], index }));
    indexed.sort((left, right) => {
      let order = rank(left.key) - rank(right.key);
      if (order === 0) {
        order = typeof left.key === "number" && typeof right.key === "number"
          ? left.key - right.key
          : text(left.key).localeCompare(text(right.key));
      }
      if (order === 0) order = left.index - right.index;
      return ascending ? order : -order;
    });
    return { kind: "spill", values: indexed.map((entry) => entry.row) };
  },
  DATE: (args) => new Date(Date.UTC(number(scalarOf(args[0])), number(scalarOf(args[1])) - 1, number(scalarOf(args[2])))),
  YEAR: (args) => asDate(scalarOf(args[0])).getUTCFullYear(),
  MONTH: (args) => asDate(scalarOf(args[0])).getUTCMonth() + 1,
  DAY: (args) => asDate(scalarOf(args[0])).getUTCDate(),
  TODAY: () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  },
  NOW: () => new Date(),
  RAND: () => Math.random(),
  RANDBETWEEN: (args) => {
    const bottom = Math.ceil(number(scalarOf(args[0])));
    const top = Math.floor(number(scalarOf(args[1])));
    if (bottom > top) throw new Error("#NUM!");
    return bottom + Math.floor(Math.random() * (top - bottom + 1));
  },
  PI: () => Math.PI,
  ABS: (args) => Math.abs(number(scalarOf(args[0]))),
  SIGN: (args) => Math.sign(number(scalarOf(args[0]))),
  SQRT: (args) => {
    const value = number(scalarOf(args[0]));
    if (value < 0) throw new Error("#NUM!");
    return Math.sqrt(value);
  },
  POWER: (args) => number(scalarOf(args[0])) ** number(scalarOf(args[1])),
  EXP: (args) => Math.exp(number(scalarOf(args[0]))),
  LN: (args) => {
    const value = number(scalarOf(args[0]));
    if (value <= 0) throw new Error("#NUM!");
    return Math.log(value);
  },
  LOG: (args, ctx) => {
    const value = number(scalarOf(args[0]));
    const base = args[1] === undefined ? 10 : number(scalarOf(args[1]));
    if (value <= 0 || base <= 0 || base === 1) throw new Error("#NUM!");
    void ctx;
    return Math.log(value) / Math.log(base);
  },
  LOG10: (args) => {
    const value = number(scalarOf(args[0]));
    if (value <= 0) throw new Error("#NUM!");
    return Math.log10(value);
  },
  MOD: (args) => {
    const divisor = number(scalarOf(args[1]));
    if (divisor === 0) throw new Error("#DIV/0!");
    const value = number(scalarOf(args[0]));
    return value - divisor * Math.floor(value / divisor);
  },
  INT: (args) => Math.floor(number(scalarOf(args[0]))),
  TRUNC: (args) => Math.trunc(number(scalarOf(args[0]))),
  ROUND: (args, ctx) => {
    void ctx;
    const value = number(scalarOf(args[0]));
    const digits = args[1] === undefined ? 0 : number(scalarOf(args[1]));
    const factor = 10 ** digits;
    return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  },
  ROUNDUP: (args) => {
    const value = number(scalarOf(args[0]));
    const factor = 10 ** (args[1] === undefined ? 0 : number(scalarOf(args[1])));
    return (Math.sign(value) * Math.ceil(Math.abs(value) * factor)) / factor;
  },
  ROUNDDOWN: (args) => {
    const value = number(scalarOf(args[0]));
    const factor = 10 ** (args[1] === undefined ? 0 : number(scalarOf(args[1])));
    return (Math.sign(value) * Math.floor(Math.abs(value) * factor)) / factor;
  },
  MROUND: (args) => {
    const multiple = number(scalarOf(args[1]));
    if (multiple === 0) return 0;
    return Math.round(number(scalarOf(args[0])) / multiple) * multiple;
  },
  CEILING: (args) => {
    const significance = args[1] === undefined ? 1 : number(scalarOf(args[1]));
    if (significance === 0) return 0;
    return Math.ceil(number(scalarOf(args[0])) / significance) * significance;
  },
  "CEILING.MATH": (args) => {
    const significance = args[1] === undefined ? 1 : Math.abs(number(scalarOf(args[1])));
    if (significance === 0) return 0;
    return Math.ceil(number(scalarOf(args[0])) / significance) * significance;
  },
  FLOOR: (args) => {
    const significance = args[1] === undefined ? 1 : number(scalarOf(args[1]));
    if (significance === 0) throw new Error("#DIV/0!");
    return Math.floor(number(scalarOf(args[0])) / significance) * significance;
  },
  "FLOOR.MATH": (args) => {
    const significance = args[1] === undefined ? 1 : Math.abs(number(scalarOf(args[1])));
    if (significance === 0) return 0;
    return Math.floor(number(scalarOf(args[0])) / significance) * significance;
  },
  SIN: (args) => Math.sin(number(scalarOf(args[0]))),
  COS: (args) => Math.cos(number(scalarOf(args[0]))),
  TAN: (args) => Math.tan(number(scalarOf(args[0]))),
  ASIN: (args) => {
    const value = number(scalarOf(args[0]));
    if (value < -1 || value > 1) throw new Error("#NUM!");
    return Math.asin(value);
  },
  ACOS: (args) => {
    const value = number(scalarOf(args[0]));
    if (value < -1 || value > 1) throw new Error("#NUM!");
    return Math.acos(value);
  },
  ATAN: (args) => Math.atan(number(scalarOf(args[0]))),
  ATAN2: (args) => Math.atan2(number(scalarOf(args[1])), number(scalarOf(args[0]))),
  DEGREES: (args) => (number(scalarOf(args[0])) * 180) / Math.PI,
  RADIANS: (args) => (number(scalarOf(args[0])) * Math.PI) / 180,
  FACT: (args) => {
    const value = Math.trunc(number(scalarOf(args[0])));
    if (value < 0) throw new Error("#NUM!");
    let result = 1;
    for (let index = 2; index <= value; index++) result *= index;
    return result;
  },
  FACTDOUBLE: (args) => {
    const value = Math.trunc(number(scalarOf(args[0])));
    if (value < -1) throw new Error("#NUM!");
    let result = 1;
    for (let index = value; index > 1; index -= 2) result *= index;
    return result;
  },
  COMBIN: (args) => {
    const total = Math.trunc(number(scalarOf(args[0])));
    const chosen = Math.trunc(number(scalarOf(args[1])));
    if (total < 0 || chosen < 0 || chosen > total) throw new Error("#NUM!");
    let result = 1;
    for (let index = 1; index <= chosen; index++) result = (result * (total - chosen + index)) / index;
    return Math.round(result);
  },
  GCD: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    const values = flat.map((value) => Math.trunc(number(value)));
    if (values.some((value) => value < 0)) throw new Error("#NUM!");
    const gcd = (left: number, right: number): number => (right === 0 ? left : gcd(right, left % right));
    return values.reduce((left, right) => gcd(left, right), 0);
  },
  LCM: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    const values = flat.map((value) => Math.trunc(number(value)));
    if (values.some((value) => value < 0)) throw new Error("#NUM!");
    const gcd = (left: number, right: number): number => (right === 0 ? left : gcd(right, left % right));
    return values.reduce((left, right) => (left === 0 || right === 0 ? 0 : (left * right) / gcd(left, right)), 1);
  },
  PRODUCT: (args, ctx) =>
    args
      .flatMap((argument) => flatten(argument, ctx))
      .reduce((product: number, value) => (value === null || value === "" ? product : product * number(value)), 1),
  SUMSQ: (args, ctx) =>
    args
      .flatMap((argument) => flatten(argument, ctx))
      .reduce((total: number, value) => (value === null || value === "" ? total : total + number(value) ** 2), 0),
  MEDIAN: (args, ctx) => {
    const values = trimNumeric(args.flatMap((argument) => flatten(argument, ctx))).sort((left, right) => left - right);
    if (values.length === 0) throw new Error("#NUM!");
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  },
  GEOMEAN: (args, ctx) => {
    const values = trimNumeric(args.flatMap((argument) => flatten(argument, ctx)));
    if (values.length === 0 || values.some((value) => value <= 0)) throw new Error("#NUM!");
    return Math.exp(values.reduce((total, value) => total + Math.log(value), 0) / values.length);
  },
  HARMEAN: (args, ctx) => {
    const values = trimNumeric(args.flatMap((argument) => flatten(argument, ctx)));
    if (values.length === 0 || values.some((value) => value <= 0)) throw new Error("#NUM!");
    return values.length / values.reduce((total, value) => total + 1 / value, 0);
  },
  LARGE: (args, ctx) => {
    const values = trimNumeric(flatten(args[0], ctx)).sort((left, right) => right - left);
    const index = Math.trunc(number(scalarOf(args[1])));
    return values[index - 1] ?? throwNumeric();
  },
  SMALL: (args, ctx) => {
    const values = trimNumeric(flatten(args[0], ctx)).sort((left, right) => left - right);
    const index = Math.trunc(number(scalarOf(args[1])));
    return values[index - 1] ?? throwNumeric();
  },
  SKEW: (args, ctx) => skewness(args, ctx, false),
  "SKEW.P": (args, ctx) => skewness(args, ctx, true),
  STDEV: (args, ctx) => stdev(sample(args, ctx), false),
  "STDEV.S": (args, ctx) => stdev(sample(args, ctx), false),
  STDEVA: (args, ctx) => stdev(sampleA(args, ctx), false),
  "STDEV.P": (args, ctx) => stdev(sample(args, ctx), true),
  STDEVP: (args, ctx) => stdev(sample(args, ctx), true),
  VAR: (args, ctx) => stdev(sample(args, ctx), false) ** 2,
  "VAR.S": (args, ctx) => stdev(sample(args, ctx), false) ** 2,
  VARA: (args, ctx) => stdev(sampleA(args, ctx), false) ** 2,
  "VAR.P": (args, ctx) => stdev(sample(args, ctx), true) ** 2,
  VARP: (args, ctx) => stdev(sample(args, ctx), true) ** 2,
  VARPA: (args, ctx) => stdev(sampleA(args, ctx), true) ** 2,
  CORREL: (args, ctx) => correlation(matrixPair(args, ctx), false),
  PEARSON: (args, ctx) => correlation(matrixPair(args, ctx), false),
  RSQ: (args, ctx) => correlation(matrixPair(args, ctx), false) ** 2,
  "COVARIANCE.P": (args, ctx) => covariance(matrixPair(args, ctx), true),
  "COVARIANCE.S": (args, ctx) => covariance(matrixPair(args, ctx), false),
  PERCENTILE: (args, ctx) => percentile(args, ctx, true),
  "PERCENTILE.INC": (args, ctx) => percentile(args, ctx, true),
  "PERCENTILE.EXC": (args, ctx) => percentile(args, ctx, false),
  QUARTILE: (args, ctx) => percentile(args, ctx, true, number(scalarOf(args[1])) / 4),
  "QUARTILE.INC": (args, ctx) => percentile(args, ctx, true, number(scalarOf(args[1])) / 4),
  "QUARTILE.EXC": (args, ctx) => percentile(args, ctx, false, number(scalarOf(args[1])) / 4),
  SUMPRODUCT: (args, ctx) => {
    const matrices = args.map((argument) => flatten(argument, ctx));
    const length = matrices[0]?.length ?? 0;
    if (matrices.some((matrix) => matrix.length !== length)) throw new Error("#VALUE!");
    let total = 0;
    for (let index = 0; index < length; index++) {
      let product = 1;
      for (const matrix of matrices) {
        const value = matrix[index];
        product *= typeof value === "number" ? value : 0;
      }
      total += product;
    }
    return total;
  },
  SUBTOTAL: (args, ctx) => {
    const code = Math.trunc(number(scalarOf(args[0])));
    const values = args.slice(1).flatMap((argument) => flatten(argument, ctx));
    const base = code > 100 ? code - 100 : code;
    if (base === 9)
      return values.reduce((total: number, value) => total + (value === null ? 0 : number(value)), 0);
    if (base === 1) {
      const numbers = trimNumeric(values);
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    if (base === 2) return trimNumeric(values).length;
    if (base === 3) return values.filter((value) => value !== null && value !== "").length;
    if (base === 4) return values.length ? Math.max(...values.filter((value) => value !== null).map(number)) : throwNumeric();
    if (base === 5) return values.length ? Math.min(...values.filter((value) => value !== null).map(number)) : throwNumeric();
    if (base === 6)
      return values.reduce(
        (product: number, value) => (value === null || value === "" ? product : product * number(value)),
        1,
      );
    throw new Error("#VALUE!");
  },
  SERIESSUM: (args, ctx) => {
    const x = number(scalarOf(args[0]));
    const power = number(scalarOf(args[1]));
    const step = number(scalarOf(args[2]));
    const coefficients = flatten(args[3], ctx).map(number);
    return coefficients.reduce((total, coefficient, index) => total + coefficient * x ** (power + index * step), 0);
  },
  BASE: (args) => {
    const value = Math.trunc(number(scalarOf(args[0])));
    const radix = Math.trunc(number(scalarOf(args[1])));
    const minLength = args[2] === undefined ? 0 : Math.trunc(number(scalarOf(args[2])));
    if (radix < 2 || radix > 36 || value < 0) throw new Error("#NUM!");
    return value.toString(radix).toUpperCase().padStart(minLength, "0");
  },
  DECIMAL: (args) => {
    const textValue = text(scalarOf(args[0]));
    const radix = Math.trunc(number(scalarOf(args[1])));
    const parsed = parseInt(textValue, radix);
    if (Number.isNaN(parsed)) throw new Error("#NUM!");
    return parsed;
  },
  ROMAN: (args) => romanNumeral(Math.trunc(number(scalarOf(args[0])))),
  ARABIC: (args) => arabicNumeral(text(scalarOf(args[0]))),

};
