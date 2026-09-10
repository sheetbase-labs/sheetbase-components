import { type FormulaBatchExecutor } from "./calculation";
export type FormulaWorkerExecutor = Readonly<{
    execute: FormulaBatchExecutor;
    dispose(): void;
}>;
/**
 * Owns one calculation worker and multiplexes topological batches over it.
 *
 * Holds a `ProgramCache` of every program already transferred: `execute`
 * strips repeats to `{ programId }` refs via `stripCachedPrograms`, so each
 * unique bytecode crosses the postMessage boundary once per executor
 * lifetime. The worker keeps the symmetric cache (`calculation.worker.ts`);
 * both caches live exactly as long as the worker does, so no eviction is
 * needed — unique program count is bounded by formula cell count.
 */
export declare function createFormulaWorkerExecutor(): FormulaWorkerExecutor;
