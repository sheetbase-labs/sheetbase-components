import { type NamedRangeTarget } from "./formulas";
import type { CellBinding, Scalar } from "./types";
import { Worksheet, type BindingResolver } from "./workbook";
/** Owns sheet identity and dependency edges that cross worksheet boundaries. */
export declare class Workbook {
    #private;
    readonly bindingResolver?: BindingResolver | undefined;
    constructor(bindingResolver?: BindingResolver | undefined);
    addSheet(name: string): Worksheet;
    sheet(name: string): Worksheet;
    set(sheetName: string, address: string, binding: CellBinding | Scalar): void;
    /** Define a workbook-scoped name. Re-defining replaces. Case-insensitive, never an A1 address. */
    defineName(name: string, target: NamedRangeTarget | string): void;
    deleteName(name: string): void;
    /** Qualified target ("Sheet!A1:A20") for a defined name, or undefined. Lookup is case-insensitive. */
    resolveName(name: string): string | undefined;
    setInput(sheetName: string, address: string, input: string): void;
    delete(sheetName: string, address: string): void;
    value(sheetName: string, address: string): Scalar;
}
