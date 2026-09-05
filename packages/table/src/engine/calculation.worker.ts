/// <reference lib="webworker" />
import {
  evaluateFormulaTasks,
  type CalculationWorkerRequest,
  type CalculationWorkerResponse,
  type ProgramCache,
} from "./calculation";

/**
 * Symmetric program cache for the transfer protocol documented in
 * `calculation.ts`: full-bytecode tasks are filed by `programId` on arrival
 * so later `{ programId }`-only tasks resolve without a second transfer.
 * Lives for the worker lifetime, mirroring the executor-side cache in
 * `worker-executor.ts`. An unknown id means the executor sent a ref before
 * its bytecode — a protocol bug — and fails the whole batch via the error
 * channel below.
 */
const programs: ProgramCache = new Map();

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener("message", (event: MessageEvent<CalculationWorkerRequest>) => {
  try {
    scope.postMessage({
      id: event.data.id,
      results: evaluateFormulaTasks(event.data.tasks, programs),
    } satisfies CalculationWorkerResponse);
  } catch (error) {
    scope.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CalculationWorkerResponse);
  }
});
