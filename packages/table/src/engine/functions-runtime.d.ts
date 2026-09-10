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
import type { SpillMatrix } from "./spill-store";
export type FunctionReference = Readonly<{
    sheet?: string;
    address: string;
}>;
export type FunctionRange = Readonly<{
    kind: "range" | "range-value";
    start: FunctionReference;
    end: FunctionReference;
}>;
export type FunctionArg = Scalar | FunctionRange | SpillMatrix;
export interface FunctionContext {
    resolve: (key: string) => Scalar;
}
export declare function isRangeArg(value: FunctionArg | undefined): value is FunctionRange;
export declare function isSpillArg(value: FunctionArg | undefined): value is SpillMatrix;
export declare function key(reference: FunctionReference): string;
/** Flatten a range/spill/scalar argument into scalars (row-major for matrices). */
export declare function flatten(value: FunctionArg, ctx: FunctionContext): Scalar[];
export declare function columnLetters(address: string): number;
export declare function matrixOf(value: FunctionArg, ctx: FunctionContext): readonly (readonly Scalar[])[];
export declare function scalarOf(value: FunctionArg | undefined): Scalar;
export declare function number(value: Scalar): number;
/** Excel serial epoch used by HyperFormula's nullDate convention (1899-12-30). */
export declare const SERIAL_EPOCH_MS: number;
export declare function asDate(value: Scalar): Date;
export declare function numbersOnly(values: Scalar[]): number[];
/**
 * Excel aggregation rule: direct scalar arguments coerce strictly (text that
 * is not numeric throws), while text, booleans and blanks inside range/spill
 * references are ignored.
 */
export declare function aggregateNumbers(args: readonly FunctionArg[], ctx: FunctionContext): number[];
export declare function text(value: Scalar): string;
export declare function boolean(value: Scalar): boolean;
/** Excel criteria: ">5", "<>text", "=x", wildcards "*son"/"s?n", or a plain equality value. */
export declare function matchesCriteria(value: Scalar, criteria: Scalar): boolean;
export declare function dayFraction(hours: Scalar, minutes: Scalar, seconds: Scalar): number;
export declare function romanNumeral(value: number): string;
export declare function arabicNumeral(textValue: string): number;
export declare function stdev(values: number[], population: boolean): number;
export declare function trimNumeric(values: Scalar[]): number[];
export type FunctionImpl = (args: readonly FunctionArg[], ctx: FunctionContext) => FormulaOutput2;
export type FormulaOutput2 = Scalar | SpillMatrix;
export declare function weekNumber(dateValue: Date, type: number): number;
export declare function confidenceNormal(args: readonly FunctionArg[]): number;
export declare function twoTailTInverse(probability: number, degreesOfFreedom: number): number;
export declare function leftTailTInverse(probability: number, degreesOfFreedom: number): number;
export declare function throwNumeric(): never;
export declare function columnName(column: number): string;
export declare function skewness(args: readonly FunctionArg[], ctx: FunctionContext, population: boolean): number;
export declare function sample(args: readonly FunctionArg[], ctx: FunctionContext): number[];
/** Excel A-suffix semantics: text counts as 0, TRUE/FALSE as 1/0, numeric
 * strings as their numbers — nothing is skipped. Empty cells are skipped. */
export declare function sampleA(args: readonly FunctionArg[], ctx: FunctionContext): number[];
export declare function matrixPair(args: readonly FunctionArg[], ctx: FunctionContext): Array<[number, number]>;
export declare function covariance(pairs: Array<[number, number]>, population: boolean): number;
export declare function correlation(pairs: Array<[number, number]>, unused: boolean): number;
export declare function percentile(args: readonly FunctionArg[], ctx: FunctionContext, inclusive: boolean, quarter?: number): number;
export declare function conditionalSum(args: readonly FunctionArg[], ctx: FunctionContext, mode: "sum" | "average"): number;
export declare function conditionalCount(args: readonly FunctionArg[], ctx: FunctionContext): [number];
export declare function conditionalPairs(args: readonly FunctionArg[], _ctx: FunctionContext): Array<[FunctionArg, Scalar]>;
export declare function conditionalSumIfs(args: readonly FunctionArg[], ctx: FunctionContext, mode: "sum" | "average"): number;
export declare function conditionalCountIfs(args: readonly FunctionArg[], ctx: FunctionContext): number;
