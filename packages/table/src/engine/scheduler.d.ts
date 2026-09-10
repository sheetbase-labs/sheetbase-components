export type DependencyGraph = ReadonlyMap<string, ReadonlySet<string>>;
export type RecalculationPlan = Readonly<{
    batches: readonly (readonly string[])[];
    cyclic: readonly string[];
}>;
/**
 * Produces stable Kahn layers for the requested dirty subgraph. Dependencies
 * outside the subgraph are already-clean inputs and do not need scheduling.
 */
export declare function planRecalculation(dirty: Iterable<string>, dependencies: DependencyGraph): RecalculationPlan;
