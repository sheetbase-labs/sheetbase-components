import type { CellChange } from "./mutations";
/** Persistent sparse cell storage with cheap copy-on-write overlays. */
export declare class CellStore implements ReadonlyMap<string, string> {
    #private;
    private constructor();
    static from(values: ReadonlyMap<string, string>): CellStore;
    apply(changes: readonly CellChange[], direction?: "forward" | "backward"): CellStore;
    get size(): number;
    get(key: string): string | undefined;
    has(key: string): boolean;
    entries(): MapIterator<[string, string]>;
    keys(): MapIterator<string>;
    values(): MapIterator<string>;
    [Symbol.iterator](): MapIterator<[string, string]>;
    forEach(callbackfn: (value: string, key: string, map: ReadonlyMap<string, string>) => void, thisArg?: unknown): void;
    materialize(): Map<string, string>;
}
