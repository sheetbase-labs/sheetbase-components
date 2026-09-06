import { evaluateBytecode, type BytecodeProgram, type FormulaOutput } from "./bytecode";
import type { Scalar } from "./types";

/**
 * Batch calculation over compiled formula programs.
 *
 * Worker transfer protocol (structured-clone postMessage):
 * - The first batch carrying a program sends the full bytecode plus its
 *   `programId`. Both the worker (`calculation.worker.ts`) and the local
 *   executor below file it in a `ProgramCache` keyed by that id.
 * - Later batches for the same id send `{ address, programId, inputs }`
 *   only — bytecode never crosses the boundary twice for one receiver.
 * - A `{ programId }` ref for an id the receiver never cached is a protocol
 *   error and fails the batch; senders must always send full bytecode first
 *   (see `stripCachedPrograms`, applied per executor/worker lifetime).
 *
 * Sync evaluation semantics are unchanged: refs resolve to the exact cached
 * program object, so `evaluateBytecode` sees identical input either way.
 * Async functions never travel this path — the bytecode `call` op only
 * consults the sync library (`functions.ts`); async work resolves
 * host-side through `async-functions.ts`.
 */
export type FormulaTask =
  | Readonly<{
      address: string;
      program: BytecodeProgram;
      programId?: string;
      inputs: Readonly<Record<string, Scalar>>;
    }>
  | Readonly<{
      address: string;
      program?: undefined;
      programId: string;
      inputs: Readonly<Record<string, Scalar>>;
    }>;

export type FormulaResult = Readonly<{ address: string; value: FormulaOutput }>;
export type FormulaBatchExecutor = (tasks: readonly FormulaTask[]) => Promise<readonly FormulaResult[]>;

/**
 * Stable content id for a compiled program.
 *
 * A hash of (source, dependencies) was chosen over a worksheet-owned
 * monotonic counter: identical formulas in different cells share one id (so
 * the second cell's bytecode is omitted too), and the id survives
 * recompilation without per-worksheet counter state. Lowering is
 * deterministic, so equal sources always lower to equal instructions —
 * hashing the source covers the bytecode. FNV-1a keeps it dependency-free
 * and cheap enough to run per task per batch.
 */
export function programIdFor(program: BytecodeProgram): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  feed(program.source);
  feed("\0");
  for (const dependency of program.dependencies) {
    feed(dependency);
    feed("\0");
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Receiver-side store: program id -> full bytecode. The worker holds one
 * for its lifetime; each local executor holds its own.
 */
export type ProgramCache = Map<string, BytecodeProgram>;

export function evaluateFormulaTasks(
  tasks: readonly FormulaTask[],
  cache: ProgramCache = new Map(),
): readonly FormulaResult[] {
  return tasks.map((task) => ({
    address: task.address,
    value: evaluateBytecode(
      resolveTaskProgram(task, cache),
      (address) => task.inputs[address] ?? null,
    ),
  }));
}

function resolveTaskProgram(task: FormulaTask, cache: ProgramCache): BytecodeProgram {
  if (task.program) {
    cache.set(task.programId ?? programIdFor(task.program), task.program);
    return task.program;
  }
  const cached = cache.get(task.programId);
  if (!cached) {
    throw new Error(
      `Unknown program "${task.programId}" for ${task.address}: send full bytecode before referencing it`,
    );
  }
  return cached;
}

/**
 * Rewrite an outbound batch against the receiver's known ids: the first
 * sighting of a program sends the full task stamped with its `programId`
 * (filing it in `cache`); repeats collapse to `{ address, programId,
 * inputs }` refs. Pass-through for tasks that already are refs. The caller
 * owns `cache` — one per executor/worker pairing, living as long as the
 * receiver's cache does.
 */
export function stripCachedPrograms(
  tasks: readonly FormulaTask[],
  cache: ProgramCache,
): FormulaTask[] {
  return tasks.map((task) => {
    if (!task.program) return task;
    const programId = task.programId ?? programIdFor(task.program);
    if (cache.has(programId)) return { address: task.address, programId, inputs: task.inputs };
    cache.set(programId, task.program);
    return { address: task.address, program: task.program, programId, inputs: task.inputs };
  });
}

/** Local in-process executor with its own program cache; accepts both task shapes. */
export function createLocalFormulaExecutor(): FormulaBatchExecutor {
  const cache: ProgramCache = new Map();
  return async (tasks) => evaluateFormulaTasks(tasks, cache);
}

export const localFormulaExecutor: FormulaBatchExecutor = createLocalFormulaExecutor();

export type CalculationWorkerRequest = Readonly<{
  id: number;
  tasks: readonly FormulaTask[];
}>;

export type CalculationWorkerResponse = Readonly<{
  id: number;
  results?: readonly FormulaResult[];
  error?: string;
}>;
