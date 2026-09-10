import type { CellAddress, CellRange } from "./types";
export declare function columnLabel(column: number): string;
export declare function parseAddress(value: string): CellAddress;
export declare function addressKey(address: CellAddress): string;
export declare function normalizeRange(range: CellRange): CellRange;
