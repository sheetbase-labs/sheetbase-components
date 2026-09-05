/**
 * The sheet function library — the single source of truth for function
 * semantics, shared by the bytecode evaluator and the direct AST evaluator.
 *
 * Operand convention: scalars, spill matrices, and lazy range references in
 * either `range` (bytecode) or `range-value` (direct evaluator) shape. Range
 * arguments expand through the resolver at call time; matrices keep their
 * shape for shape-sensitive functions (VLOOKUP, INDEX, TRANSPOSE, FILTER).
 *
 * Errors are Excel-style strings ("#VALUE!", "#N/A", "#NUM!", "#DIV/0!").
 */
import type { Scalar } from "./types";
import {
  invertIncreasing,
  normalInverse,
  tCdf,
} from "./statistics";
import type { SpillMatrix } from "./spill-store";

export type FunctionReference = Readonly<{ sheet?: string; address: string }>;
export type FunctionRange = Readonly<{ kind: "range" | "range-value"; start: FunctionReference; end: FunctionReference }>;
export type FunctionArg = Scalar | FunctionRange | SpillMatrix;

export interface FunctionContext {
  resolve: (key: string) => Scalar;
}

export function isRangeArg(value: FunctionArg | undefined): value is FunctionRange {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    "kind" in value &&
    (value.kind === "range" || value.kind === "range-value")
  );
}

export function isSpillArg(value: FunctionArg | undefined): value is SpillMatrix {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    "kind" in value &&
    value.kind === "spill"
  );
}

export function key(reference: FunctionReference): string {
  return reference.sheet ? `${reference.sheet}!${reference.address}` : reference.address;
}

/** Flatten a range/spill/scalar argument into scalars (row-major for matrices). */
export function flatten(value: FunctionArg, ctx: FunctionContext): Scalar[] {
  if (isSpillArg(value)) return value.values.flat();
  if (!isRangeArg(value)) return [value as Scalar];
  if (value.start.sheet !== value.end.sheet) throw new Error("#REF!");
  const topLeftRow = Number(value.start.address.replace(/[^0-9]/g, ""));
  const bottomRightRow = Number(value.end.address.replace(/[^0-9]/g, ""));
  const topLeftColumn = columnLetters(value.start.address);
  const bottomRightColumn = columnLetters(value.end.address);
  const values: Scalar[] = [];
  for (let row = Math.min(topLeftRow, bottomRightRow); row <= Math.max(topLeftRow, bottomRightRow); row++) {
    for (let column = Math.min(topLeftColumn, bottomRightColumn); column <= Math.max(topLeftColumn, bottomRightColumn); column++) {
      values.push(ctx.resolve(key({ sheet: value.start.sheet, address: `${columnName(column)}${row}` })));
    }
  }
  return values;
}

export function columnLetters(address: string): number {
  const letters = (address.match(/[A-Z]+/g) ?? ["A"]).join("");
  return letters.split("").reduce((total, ch) => total * 26 + (ch.charCodeAt(0) - 64), 0);
}

export function matrixOf(value: FunctionArg, ctx: FunctionContext): readonly (readonly Scalar[])[] {
  if (isSpillArg(value)) return value.values;
  if (!isRangeArg(value)) return [[value as Scalar]];
  const flat = flatten(value, ctx);
  const topLeft = value.start.address;
  const bottomRight = value.end.address;
  const columns = Math.abs(columnLetters(bottomRight) - columnLetters(topLeft)) + 1;
  const rows: Scalar[][] = [];
  for (let index = 0; index < flat.length; index += columns) {
    rows.push(flat.slice(index, index + columns));
  }
  return rows;
}

export function scalarOf(value: FunctionArg | undefined): Scalar {
  if (value === undefined || isRangeArg(value) || isSpillArg(value)) throw new Error("#VALUE!");
  return value as Scalar;
}

export function number(value: Scalar): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("#VALUE!");
  return parsed;
}

/** Excel serial epoch used by HyperFormula's nullDate convention (1899-12-30). */
export const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function asDate(value: Scalar): Date {
  if (value instanceof Date) return value;
  // Numeric inputs are Excel date serials against the 1899-12-30 epoch —
  // the convention the persisted scientific literal codec uses.
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(SERIAL_EPOCH_MS + value * 86_400_000);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("#VALUE!");
  return parsed;
}

export function numbersOnly(values: Scalar[]): number[] {
  return values.flatMap((value) => typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) ? [number(value)] : []);
}
/**
 * Excel aggregation rule: direct scalar arguments coerce strictly (text that
 * is not numeric throws), while text, booleans and blanks inside range/spill
 * references are ignored.
 */
export function aggregateNumbers(args: readonly FunctionArg[], ctx: FunctionContext): number[] {
  const values: number[] = [];
  for (const argument of args) {
    if (isRangeArg(argument) || isSpillArg(argument)) {
      for (const value of flatten(argument, ctx)) {
        if (typeof value === "number") values.push(value);
      }
    } else {
      values.push(number(scalarOf(argument)));
    }
  }
  return values;
}

export function text(value: Scalar): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function boolean(value: Scalar): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value.toUpperCase() === "TRUE") return true;
    if (value.toUpperCase() === "FALSE") return false;
  }
  throw new Error("#VALUE!");
}

/** Excel criteria: ">5", "<>text", "=x", wildcards "*son"/"s?n", or a plain equality value. */
export function matchesCriteria(value: Scalar, criteria: Scalar): boolean {
  if (criteria === null || criteria === undefined) return value === null || value === "";
  if (typeof criteria === "string") {
    const structured = /^(>=|<=|<>|>|<|=)(.*)$/.exec(criteria);
    if (structured) {
      const [, operator, raw] = structured;
      const expected = raw === "" ? null : Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : raw;
      const compare = (left: number, right: number) =>
        operator === ">" ? left > right : operator === "<" ? left < right : operator === ">=" ? left >= right : operator === "<=" ? left <= right : false;
      switch (operator) {
        case "<>":
          return !matchesCriteria(value, expected as Scalar);
        case "=":
          return matchesCriteria(value, expected as Scalar);
        case ">":
        case "<":
        case ">=":
        case "<=": {
          if (typeof value === "number" && typeof expected === "number") return compare(value, expected);
          if (typeof value === "string" && typeof expected === "string")
            return compare(value.toLowerCase().localeCompare(expected.toLowerCase()), 0);
          if (value === null) return false;
          return compare(number(value), Number(expected));
        }
      }
    }
    if (criteria.includes("*") || criteria.includes("?")) {
      const pattern = criteria
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")
        .toLowerCase();
      return text(value).toLowerCase().startsWith(pattern.endsWith(".*") ? pattern.slice(0, -2) : pattern) || new RegExp(`^${pattern}$`, "i").test(text(value));
    }
    const expected = Number.isFinite(Number(criteria)) && criteria.trim() !== "" ? Number(criteria) : criteria;
    if (typeof expected === "number") return number(value) === expected;
    return text(value).toLowerCase() === criteria.toLowerCase();
  }
  return value === criteria;
}

export function dayFraction(hours: Scalar, minutes: Scalar, seconds: Scalar): number {
  return (number(hours) * 3600 + number(minutes) * 60 + number(seconds)) / 86_400;
}

export function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) throw new Error("#VALUE!");
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [amount, numeral] of table) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }
  return result;
}

export function arabicNumeral(textValue: string): number {
  const input = textValue.trim().toUpperCase().replace(/^NEGATIVE/, "-");
  const negative = input.startsWith("-");
  const body = negative ? input.slice(1) : input;
  const values = new Map([["I", 1], ["V", 5], ["X", 10], ["L", 50], ["C", 100], ["D", 500], ["M", 1000]]);
  let total = 0;
  for (let index = 0; index < body.length; index++) {
    const current = values.get(body[index] ?? "");
    const next = values.get(body[index + 1] ?? "");
    if (current === undefined) throw new Error("#VALUE!");
    total += next !== undefined && current < next ? -current : current;
  }
  if (!Number.isInteger(total)) throw new Error("#VALUE!");
  return negative ? -total : total;
}

export function stdev(values: number[], population: boolean): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (population ? values.length : values.length - 1);
  return Math.sqrt(variance);
}

export function trimNumeric(values: Scalar[]): number[] {
  return numbersOnly(values);
}

export type FunctionImpl = (args: readonly FunctionArg[], ctx: FunctionContext) => FormulaOutput2;
export type FormulaOutput2 = Scalar | SpillMatrix;

export function weekNumber(dateValue: Date, type: number): number {
  const startDay = type === 2 ? 1 : 0;
  const date = new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
  const offset = (date.getUTCDay() - startDay + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - offset);
  const yearStart = new Date(Date.UTC(weekStart.getUTCFullYear(), 0, 1));
  const yearOffset = (yearStart.getUTCDay() - startDay + 7) % 7;
  yearStart.setUTCDate(yearStart.getUTCDate() - yearOffset);
  return 1 + Math.round((weekStart.getTime() - yearStart.getTime()) / (7 * 86_400_000));
}

export function confidenceNormal(args: readonly FunctionArg[]): number {
  const alpha = number(scalarOf(args[0]));
  const sd = number(scalarOf(args[1]));
  const size = Math.trunc(number(scalarOf(args[2])));
  if (alpha <= 0 || alpha >= 1 || sd <= 0 || size < 1) throw new Error("#NUM!");
  return normalInverse(1 - alpha / 2) * (sd / Math.sqrt(size));
}

export function twoTailTInverse(probability: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0) throw new Error("#NUM!");
  if (probability <= 0 || probability > 1) throw new Error("#NUM!");
  return invertIncreasing((x) => tCdf(x, degreesOfFreedom), 1 - probability / 2);
}

export function leftTailTInverse(probability: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0) throw new Error("#NUM!");
  if (probability <= 0 || probability >= 1) throw new Error("#NUM!");
  if (probability === 0.5) return 0;
  if (probability > 0.5) return invertIncreasing((x) => tCdf(x, degreesOfFreedom), probability);
  return -invertIncreasing((x) => tCdf(x, degreesOfFreedom), 1 - probability);
}

export function throwNumeric(): never {
  throw new Error("#NUM!");
}

export function columnName(column: number): string {
  let name = "";
  let remaining = column;
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    name = String.fromCharCode(65 + offset) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}

export function skewness(args: readonly FunctionArg[], ctx: FunctionContext, population: boolean): number {
  const values = trimNumeric(args.flatMap((argument) => flatten(argument, ctx)));
  const count = values.length;
  if (count < (population ? 2 : 3)) throw new Error("#DIV/0!");
  const mean = values.reduce((total, value) => total + value, 0) / count;
  const denominator = population
    ? Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / count)
    : Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1));
  if (denominator === 0) throw new Error("#DIV/0!");
  const cubed = values.reduce((total, value) => total + ((value - mean) / denominator) ** 3, 0);
  return population ? cubed / count : (count / ((count - 1) * (count - 2))) * cubed;
}

export function sample(args: readonly FunctionArg[], ctx: FunctionContext): number[] {
  const values = trimNumeric(args.flatMap((argument) => flatten(argument, ctx)));
  if (values.length < 2) throw new Error("#DIV/0!");
  return values;
}

/** Excel A-suffix semantics: text counts as 0, TRUE/FALSE as 1/0, numeric
 * strings as their numbers — nothing is skipped. Empty cells are skipped. */
export function sampleA(args: readonly FunctionArg[], ctx: FunctionContext): number[] {
  const flat = args.flatMap((argument) => flatten(argument, ctx));
  const values: number[] = [];
  for (const value of flat) {
    if (value === null || value === "") continue;
    if (typeof value === "boolean") values.push(value ? 1 : 0);
    else {
      const parsed = Number(value);
      values.push(Number.isFinite(parsed) ? parsed : 0);
    }
  }
  if (values.length < 1) throw new Error("#DIV/0!");
  return values;
}

export function matrixPair(args: readonly FunctionArg[], ctx: FunctionContext): Array<[number, number]> {
  const left = flatten(args[0], ctx);
  const right = flatten(args[1], ctx);
  if (left.length !== right.length || left.length === 0) throw new Error("#N/A");
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (typeof a === "number" && typeof b === "number") pairs.push([a, b]);
  }
  return pairs;
}

export function covariance(pairs: Array<[number, number]>, population: boolean): number {
  if (pairs.length < (population ? 1 : 2)) throw new Error("#DIV/0!");
  const meanLeft = pairs.reduce((total, [a]) => total + a, 0) / pairs.length;
  const meanRight = pairs.reduce((total, [, b]) => total + b, 0) / pairs.length;
  return (
    pairs.reduce((total, [a, b]) => total + (a - meanLeft) * (b - meanRight), 0) /
    (population ? pairs.length : pairs.length - 1)
  );
}

export function correlation(pairs: Array<[number, number]>, unused: boolean): number {
  void unused;
  if (pairs.length < 2) throw new Error("#DIV/0!");
  const meanLeft = pairs.reduce((total, [a]) => total + a, 0) / pairs.length;
  const meanRight = pairs.reduce((total, [, b]) => total + b, 0) / pairs.length;
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const [a, b] of pairs) {
    numerator += (a - meanLeft) * (b - meanRight);
    leftSquared += (a - meanLeft) ** 2;
    rightSquared += (b - meanRight) ** 2;
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  if (denominator === 0) throw new Error("#DIV/0!");
  return numerator / denominator;
}

export function percentile(args: readonly FunctionArg[], ctx: FunctionContext, inclusive: boolean, quarter?: number): number {
  const values = trimNumeric(flatten(args[0], ctx)).sort((left, right) => left - right);
  if (values.length === 0) throw new Error("#NUM!");
  const fraction = quarter ?? number(scalarOf(args[1]));
  if (fraction < 0 || fraction > 1) throw new Error("#NUM!");
  const position = inclusive ? fraction * (values.length - 1) : fraction * (values.length + 1) - 1;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower < 0 || upper >= values.length) throw new Error("#NUM!");
  const weight = position - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

export function conditionalSum(args: readonly FunctionArg[], ctx: FunctionContext, mode: "sum" | "average"): number {
  const criteriaRange = flatten(args[0], ctx);
  const criteria = scalarOf(args[1] ?? null);
  const sumRange = args[2] === undefined ? criteriaRange : flatten(args[2], ctx);
  let total = 0;
  let count = 0;
  criteriaRange.forEach((value, index) => {
    if (matchesCriteria(value, criteria)) {
      const target = sumRange[index];
      if (typeof target === "number") {
        total += target;
        count += 1;
      }
    }
  });
  if (mode === "average") {
    if (count === 0) throw new Error("#DIV/0!");
    return total / count;
  }
  return total;
}

export function conditionalCount(args: readonly FunctionArg[], ctx: FunctionContext): [number] {
  const criteriaRange = flatten(args[0], ctx);
  const criteria = scalarOf(args[1] ?? null);
  return [criteriaRange.filter((value) => matchesCriteria(value, criteria)).length];
}

export function conditionalPairs(args: readonly FunctionArg[], _ctx: FunctionContext): Array<[FunctionArg, Scalar]> {
  const pairs: Array<[FunctionArg, Scalar]> = [];
  for (let index = 1; index + 1 < args.length; index += 2) {
    pairs.push([args[index], scalarOf(args[index + 1])]);
  }
  return pairs;
}

export function conditionalSumIfs(args: readonly FunctionArg[], ctx: FunctionContext, mode: "sum" | "average"): number {
  const sumRange = flatten(args[0], ctx);
  const pairs = conditionalPairs(args, ctx);
  const ranges = pairs.map(([range]) => flatten(range, ctx));
  const criteriaList = pairs.map(([, criteria]) => criteria);
  let total = 0;
  let count = 0;
  for (let index = 0; index < sumRange.length; index++) {
    if (ranges.every((range, pairIndex) => matchesCriteria(range[index] ?? null, criteriaList[pairIndex]))) {
      const target = sumRange[index];
      if (typeof target === "number") {
        total += target;
        count += 1;
      }
    }
  }
  if (mode === "average") {
    if (count === 0) throw new Error("#DIV/0!");
    return total / count;
  }
  return total;
}

export function conditionalCountIfs(args: readonly FunctionArg[], ctx: FunctionContext): number {
  const pairs: Array<[FunctionArg, Scalar]> = [];
  for (let index = 0; index + 1 < args.length; index += 2) {
    pairs.push([args[index], scalarOf(args[index + 1])]);
  }
  const ranges = pairs.map(([range]) => flatten(range, ctx));
  const criteriaList = pairs.map(([, criteria]) => criteria);
  let count = 0;
  for (let index = 0; index < (ranges[0]?.length ?? 0); index++) {
    if (ranges.every((range, pairIndex) => matchesCriteria(range[index] ?? null, criteriaList[pairIndex]))) count += 1;
  }
  return count;
}
