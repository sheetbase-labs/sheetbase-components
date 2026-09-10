import type { FormulaBatchExecutor } from "./calculation";
import { type NamedRangeTarget } from "./formulas";
import { RangeStore } from "./range-store";
import { SpillStore } from "./spill-store";
import { type RecalculationPlan } from "./scheduler";
import type { CellBinding, Scalar } from "./types";
export type ExternalCellBinding = Extract<CellBinding, {
    kind: "record-field" | "query-result";
}>;
export type BindingResolver = (binding: ExternalCellBinding) => Scalar;
export type ReferenceResolver = (qualifiedAddress: string) => Scalar;
export type FormulaNormalizer = (expression: string) => string;
export type FormulaMode = "evaluate" | "literal";
export type WorksheetOptions = Readonly<{
    formulaMode?: FormulaMode;
}>;
export declare class Worksheet {
    #private;
    readonly formats: RangeStore<Readonly<{
        numberFormat?: "general" | "number" | "currency" | "percent" | "date";
        background?: string;
        foreground?: string;
        fontWeight?: 400 | 500 | 600 | 700;
        horizontalAlign?: "left" | "center" | "right";
    }>>;
    readonly spills: SpillStore;
    constructor(resolver?: BindingResolver, referenceResolver?: ReferenceResolver, formulaNormalizer?: FormulaNormalizer, options?: WorksheetOptions);
    setBindingResolver(resolver: BindingResolver): void;
    setReferenceResolver(resolver: ReferenceResolver): void;
    /** Recompile formulas when structured-reference resolution changes. */
    renormalizeFormulas(): void;
    /** Define a workbook-scoped name targeting a qualified range. Re-defining replaces. Names are case-insensitive and never collide with A1 addresses. */
    defineName(name: string, target: NamedRangeTarget | string): void;
    deleteName(name: string): void;
    /** Qualified target ("Sheet!A1:A20") for a defined name, or undefined. Lookup is case-insensitive. */
    resolveName(name: string): string | undefined;
    /** Normalized addresses of cells holding formulas. */
    formulaAddresses(): readonly string[];
    set(address: string, binding: CellBinding | Scalar): void;
    setInput(address: string, input: string): void;
    setFormulaMode(mode: FormulaMode): void;
    delete(address: string): void;
    invalidate(address: string): void;
    invalidateAll(): void;
    dirtyCells(): readonly string[];
    recalculate(addresses?: Iterable<string>): ReadonlyMap<string, Scalar>;
    recalculateAsync(executor: FormulaBatchExecutor, addresses?: Iterable<string>): Promise<ReadonlyMap<string, Scalar>>;
    recalculationPlan(addresses?: Iterable<string>): RecalculationPlan;
    dependencyAddresses(address: string): readonly string[];
    binding(address: string): CellBinding | undefined;
    input(address: string): string;
    value(address: string, stack?: Set<string>): Scalar;
    dependents(address: string): readonly string[];
}
