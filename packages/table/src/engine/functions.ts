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
import { INFO_FUNCTIONS } from "./functions-info";
import { CORE_FUNCTIONS } from "./functions-core";
import { TEXT_FUNCTIONS } from "./functions-text";
import { LOOKUP_FUNCTIONS } from "./functions-lookup";

export type {
  FunctionArg,
  FunctionContext,
  FunctionRange,
  FunctionReference,
  FunctionImpl,
} from "./functions-runtime";
export { SERIAL_EPOCH_MS } from "./functions-runtime";

const FUNCTIONS = {
  ...INFO_FUNCTIONS,
  ...CORE_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
};

/** Every function name in the registry, sorted. Demos and docs consume this so coverage stays honest. */
export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS).sort();

/** Functions that must recalculate on every pass; the scheduler consumes this set. */
export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set(["NOW", "TODAY", "RAND", "RANDBETWEEN"]);

export function isVolatileFunction(name: string): boolean {
  return VOLATILE_FUNCTIONS.has(name.toUpperCase());
}

/** Dispatch a function by name. Unknown names raise Excel's #NAME?. */
export function callFunction(
  name: string,
  args: readonly FunctionArg[],
  ctx: FunctionContext,
): Scalar | SpillMatrix {
  const implementation = FUNCTIONS[name.toUpperCase()];
  if (!implementation) throw new Error("#NAME?");
  return implementation(args, ctx);
}
