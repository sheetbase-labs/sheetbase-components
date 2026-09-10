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
import type { FunctionArg, FunctionContext } from "./functions-runtime";
export type { FunctionArg, FunctionContext, FunctionRange, FunctionReference, FunctionImpl, } from "./functions-runtime";
export { SERIAL_EPOCH_MS } from "./functions-runtime";
/** Every function name in the registry, sorted. Demos and docs consume this so coverage stays honest. */
export declare const FUNCTION_NAMES: readonly string[];
/** Functions that must recalculate on every pass; the scheduler consumes this set. */
export declare const VOLATILE_FUNCTIONS: ReadonlySet<string>;
export declare function isVolatileFunction(name: string): boolean;
/** Dispatch a function by name. Unknown names raise Excel's #NAME?. */
export declare function callFunction(name: string, args: readonly FunctionArg[], ctx: FunctionContext): Scalar | SpillMatrix;
