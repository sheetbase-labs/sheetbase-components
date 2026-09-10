import type { Scalar } from "./types";
export type SpillMatrix = Readonly<{
    kind: "spill";
    values: readonly (readonly Scalar[])[];
}>;
export type SpillWrite = ReadonlyMap<string, Scalar>;
/** Tracks one owner per dynamic-array range and makes replacement atomic. */
export declare class SpillStore {
    #private;
    owner(address: string): string | undefined;
    value(address: string): Scalar | undefined;
    /** Owned addresses for one spill anchor, in write order; [] when the anchor owns nothing. */
    range(anchor: string): readonly string[];
    write(anchor: string, values: readonly (readonly Scalar[])[], blocked: (address: string) => boolean): SpillWrite;
    clearAnchor(anchor: string): readonly string[];
    clearAt(address: string): Readonly<{
        owner: string;
        addresses: readonly string[];
    }> | undefined;
}
