import type { CellAddress, CellRange } from "./types";
/**
 * Canonical last-write-wins range storage inspired by Equals' published design:
 * statically-shaped rectangles in a Map plus an R-tree intersection index.
 */
export declare class RangeStore<T> {
    #private;
    constructor(equals?: (a: T, b: T) => boolean);
    get size(): number;
    entries(): readonly {
        range: CellRange;
        value: T;
    }[];
    clone(): RangeStore<T>;
    get(point: CellAddress): T | undefined;
    query(range: CellRange): readonly {
        range: CellRange;
        value: T;
    }[];
    write(range: CellRange, value: T): void;
}
