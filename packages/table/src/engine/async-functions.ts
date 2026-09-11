import type { Scalar } from "./types";
import { callFunction, type FunctionArg, type FunctionContext } from "./functions";
import type { SpillMatrix } from "./spill-store";
import { evaluateBytecodeAsync, type FormulaOutput } from "./bytecode";
import {
  localFormulaExecutor,
  resolveTaskProgram,
  type FormulaBatchExecutor,
  type FormulaResult,
  type FormulaTask,
  type ProgramCache,
} from "./calculation";

/**
 * Host-gated async functions.
 *
 * Sync evaluation (`bytecode.ts` `call` op -> `callFunction`) never consults
 * this registry, so workers can never execute async work implicitly: an
 * async-only name evaluates to `#NAME?` off-host, exactly like any unknown
 * function. Async evaluation happens host-side only, through
 * `AsyncFunctionRegistry.call`, which enforces the capability gate in one
 * place so call sites cannot forget it.
 *
 * Capabilities are plain strings in an explicit granted-set the host opts
 * into via `grant`. Nothing is granted by default, so every
 * capability-gated call evaluates to `#BLOCKED!` until the host opts in.
 * The real transport for gated work stays host-side: hosts replace the
 * built-in stub with their own implementation under the same capability.
 */
export type AsyncFunction = (
  args: readonly FunctionArg[],
  ctx: FunctionContext,
) => Promise<Scalar | SpillMatrix>;

export type AsyncFunctionOptions = Readonly<{
  /** Capability that must be granted before this function may run. Absent = always runnable host code. */
  capability?: string;
}>;

/** Capability guarding the built-in QUERYRECORDS stub. */
export const QUERY_RECORDS_CAPABILITY = "query:records";

/**
 * In-engine placeholder for record queries. Returns null when its
 * capability is granted; the host replaces it via `register` with the real
 * fetch wired to its own transport.
 */
async function queryRecordsStub(): Promise<Scalar> {
  return null;
}

export class AsyncFunctionRegistry {
  readonly #entries = new Map<string, { fn: AsyncFunction; capability: string | undefined }>();
  readonly #granted = new Set<string>();

  constructor() {
    this.register("QUERYRECORDS", queryRecordsStub, { capability: QUERY_RECORDS_CAPABILITY });
  }

  /** Register (or replace) a function; names are case-insensitive like the sync library. */
  register(name: string, fn: AsyncFunction, options: AsyncFunctionOptions = {}): void {
    this.#entries.set(name.toUpperCase(), { fn, capability: options.capability });
  }

  has(name: string): boolean {
    return this.#entries.has(name.toUpperCase());
  }

  get(name: string): AsyncFunction | undefined {
    return this.#entries.get(name.toUpperCase())?.fn;
  }

  capabilityFor(name: string): string | undefined {
    return this.#entries.get(name.toUpperCase())?.capability;
  }

  grant(capability: string): void {
    this.#granted.add(capability);
  }

  revoke(capability: string): void {
    this.#granted.delete(capability);
  }

  isCapabilityGranted(capability: string): boolean {
    return this.#granted.has(capability);
  }

  /**
   * Host-side lookup + gate + dispatch. Unknown names raise `#NAME?`
   * (mirroring sync `callFunction`); capability-gated names raise
   * `#BLOCKED!` unless the host granted the capability. Never call this
   * inside a worker.
   */
  async call(
    name: string,
    args: readonly FunctionArg[],
    ctx: FunctionContext,
  ): Promise<Scalar | SpillMatrix> {
    const entry = this.#entries.get(name.toUpperCase());
    if (!entry) throw new Error("#NAME?");
    if (entry.capability !== undefined && !this.#granted.has(entry.capability)) {
      throw new Error("#BLOCKED!");
    }
    return entry.fn(args, ctx);
  }
}

export interface AsyncFormulaExecutor {
  /** Drop-in executor for `Worksheet.recalculateAsync`. */
  execute: FormulaBatchExecutor;
  /**
   * Addresses whose programs contain at least one registered async call —
   * the set a host invalidates when the underlying data revision advances.
   */
  asyncAddresses(): readonly string[];
}

/**
 * The dispatch point between sync bytecode evaluation and the registry: a
 * `FormulaBatchExecutor` that routes programs containing a registered async
 * call through `evaluateBytecodeAsync` (registry-gated, host-side) and lets
 * every other task fall through to `fallback` (worker or local).
 *
 * Because `call` ops inside an async program dispatch by name, sync and async
 * functions compose freely: `=SUM(QUERYRECORDS("d","f"))` awaits the fetch
 * then sums the spill.
 */
export function createAsyncFormulaExecutor(
  registry: AsyncFunctionRegistry,
  fallback: FormulaBatchExecutor = localFormulaExecutor,
): AsyncFormulaExecutor {
  const programs: ProgramCache = new Map();
  const seen = new Set<string>();
  const callAsync = async (name: string, args: FunctionArg[], resolve: FunctionContext["resolve"]): Promise<FormulaOutput> =>
    registry.has(name)
      ? registry.call(name, args, { resolve })
      : callFunction(name, args, { resolve });
  return {
    execute: async (tasks) => {
      const syncTasks: FormulaTask[] = [];
      const results: FormulaResult[] = [];
      for (const task of tasks) {
        const program = resolveTaskProgram(task, programs);
        if (!program.instructions.some((instruction) => instruction.op === "call" && registry.has(instruction.name))) {
          syncTasks.push(task);
          continue;
        }
        seen.add(task.address);
        results.push({
          address: task.address,
          value: await evaluateBytecodeAsync(program, (address) => task.inputs[address] ?? null, callAsync),
        });
      }
      if (syncTasks.length) results.push(...(await fallback(syncTasks)));
      return results;
    },
    asyncAddresses: () => [...seen],
  };
}
