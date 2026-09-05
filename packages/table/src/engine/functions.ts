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
  sampleSummary,
} from "./statistics";
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
} from "./statistics";
import type { SpillMatrix } from "./spill-store";

export type FunctionReference = Readonly<{ sheet?: string; address: string }>;
export type FunctionRange = Readonly<{ kind: "range" | "range-value"; start: FunctionReference; end: FunctionReference }>;
export type FunctionArg = Scalar | FunctionRange | SpillMatrix;

export interface FunctionContext {
  resolve: (key: string) => Scalar;
}

function isRangeArg(value: FunctionArg | undefined): value is FunctionRange {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    "kind" in value &&
    (value.kind === "range" || value.kind === "range-value")
  );
}
