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
export type AsyncFunction = (args: readonly FunctionArg[], ctx: FunctionContext) => Promise<Scalar | SpillMatrix>;
export type AsyncFunctionOptions = Readonly<{
    /** Capability that must be granted before this function may run. Absent = always runnable host code. */
    capability?: string;
}>;
/** Capability guarding the built-in QUERYRECORDS stub. */
export declare const QUERY_RECORDS_CAPABILITY = "query:records";
export declare class AsyncFunctionRegistry {
    #private;
    constructor();
    /** Register (or replace) a function; names are case-insensitive like the sync library. */
    register(name: string, fn: AsyncFunction, options?: AsyncFunctionOptions): void;
    has(name: string): boolean;
    get(name: string): AsyncFunction | undefined;
    capabilityFor(name: string): string | undefined;
    grant(capability: string): void;
    revoke(capability: string): void;
    isCapabilityGranted(capability: string): boolean;
    /**
     * Host-side lookup + gate + dispatch. Unknown names raise `#NAME?`
     * (mirroring sync `callFunction`); capability-gated names raise
     * `#BLOCKED!` unless the host granted the capability. Never call this
     * inside a worker.
     */
    call(name: string, args: readonly FunctionArg[], ctx: FunctionContext): Promise<Scalar | SpillMatrix>;
}
