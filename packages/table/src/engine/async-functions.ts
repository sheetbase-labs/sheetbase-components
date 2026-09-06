import type { Scalar } from "./types";
import type { FunctionArg, FunctionContext } from "./functions";
import type { SpillMatrix } from "./spill-store";

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
