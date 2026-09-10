import type { CompiledFormula, FormulaReference, ValueResolver } from "./formulas";
import type { Scalar } from "./types";
import type { SpillMatrix } from "./spill-store";
export type FormulaInstruction = Readonly<{
    op: "push";
    value: Scalar;
}> | Readonly<{
    op: "reference";
    reference: FormulaReference;
}> | Readonly<{
    op: "range";
    start: FormulaReference;
    end: FormulaReference;
}> | Readonly<{
    op: "unary";
    operator: "+" | "-";
}> | Readonly<{
    op: "binary";
    operator: string;
}> | Readonly<{
    op: "call";
    name: string;
    argumentCount: number;
}> | Readonly<{
    op: "jump-if-false";
    target: number;
}> | Readonly<{
    op: "jump";
    target: number;
}> | Readonly<{
    op: "drop";
}>
/** Lazy error boundary (IFERROR/ISERROR): errors raised after `target`'s
 * origin jump to `target` with the stack restored to `depth`. */
 | Readonly<{
    op: "catch";
    target: number;
    depth: number;
}> | Readonly<{
    op: "uncatch";
}>;
export type BytecodeProgram = Readonly<{
    source: string;
    instructions: readonly FormulaInstruction[];
    dependencies: readonly string[];
}>;
export type FormulaOutput = Scalar | SpillMatrix;
export declare function lowerFormula(program: CompiledFormula): BytecodeProgram;
export declare function evaluateBytecode(program: BytecodeProgram, resolve: ValueResolver): FormulaOutput;
