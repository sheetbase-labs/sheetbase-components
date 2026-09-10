import type { Scalar } from "./types";
export type ValueResolver = (address: string) => Scalar;
export type FormulaReference = Readonly<{
    sheet?: string;
    address: string;
}>;
export type FormulaNode = Readonly<{
    kind: "literal";
    value: Scalar;
}> | Readonly<{
    kind: "reference";
    reference: FormulaReference;
}> | Readonly<{
    kind: "range";
    start: FormulaReference;
    end: FormulaReference;
}> | Readonly<{
    kind: "unary";
    operator: "+" | "-";
    operand: FormulaNode;
}> | Readonly<{
    kind: "binary";
    operator: string;
    left: FormulaNode;
    right: FormulaNode;
}> | Readonly<{
    kind: "call";
    name: string;
    arguments: readonly FormulaNode[];
}>;
export type CompiledFormula = Readonly<{
    source: string;
    root: FormulaNode;
    dependencies: readonly string[];
}>;
export type NamedRangeTarget = Readonly<{
    sheet: string;
    range: string;
}>;
/** Name table for compileFormula: normalized name (uppercased) -> qualified target ("Sheet!A1:A20" or "Sheet!A1"). */
export type FormulaNameTable = ReadonlyMap<string, string>;
export declare function normalizeName(name: string): string;
/** Workbook-scoped defined-name validation: identifier shape, never a bare A1 address. Re-defining replaces. */
export declare function assertValidName(name: string): void;
/** Normalize a { sheet, range } target to qualified "Sheet!A1:A20" form. A range that already carries a sheet prefix is used as-is. */
export declare function normalizeNameTarget(sheet: string, range: string): string;
/** Accepts the { sheet, range } form or an already-qualified "Sheet!A1:A20" string. */
export declare function normalizeNameTargetInput(target: NamedRangeTarget | string): string;
export declare function compileFormula(expression: string, names?: FormulaNameTable): CompiledFormula;
export declare function dependencies(expression: string | CompiledFormula, names?: FormulaNameTable): readonly string[];
/** Dependency discovery used while a user is still typing an incomplete formula. */
export declare function editableDependencies(expression: string, names?: FormulaNameTable): readonly string[];
export declare function evaluateFormula(expression: string, resolve: ValueResolver, names?: FormulaNameTable): Scalar;
export declare function evaluateCompiledFormula(program: CompiledFormula, resolve: ValueResolver): Scalar;
