import {
  stripCachedPrograms,
  type CalculationWorkerRequest,
  type CalculationWorkerResponse,
  type FormulaBatchExecutor,
  type FormulaResult,
  type ProgramCache,
} from "./calculation";

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
export function createFormulaWorkerExecutor(): FormulaWorkerExecutor {
  const worker = new Worker(new URL("./calculation.worker.ts", import.meta.url), { type: "module" });
  let sequence = 0;
  const pending = new Map<number, {
    resolve(value: readonly FormulaResult[]): void;
    reject(reason: Error): void;
  }>();
  const programs: ProgramCache = new Map();

  worker.addEventListener("message", (event: MessageEvent<CalculationWorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.results ?? []);
  });

  return {
    execute(tasks) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({
          id,
          tasks: stripCachedPrograms(tasks, programs),
        } satisfies CalculationWorkerRequest);
      });
    },
    dispose() {
      worker.terminate();
      for (const request of pending.values()) request.reject(new Error("Calculation worker disposed"));
      pending.clear();
    },
  };
}
