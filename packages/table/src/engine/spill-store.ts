import { addressKey, parseAddress } from "./coordinates";
import type { Scalar } from "./types";

export type SpillMatrix = Readonly<{ kind: "spill"; values: readonly (readonly Scalar[])[] }>;
export type SpillWrite = ReadonlyMap<string, Scalar>;

/** Tracks one owner per dynamic-array range and makes replacement atomic. */
export class SpillStore {
  readonly #owners = new Map<string, string>();
  readonly #ranges = new Map<string, Map<string, Scalar>>();

  owner(address: string): string | undefined { return this.#owners.get(address); }
  value(address: string): Scalar | undefined { return this.#ranges.get(this.#owners.get(address) ?? "")?.get(address); }
  /** Owned addresses for one spill anchor, in write order; [] when the anchor owns nothing. */
  range(anchor: string): readonly string[] { return [...(this.#ranges.get(anchor)?.keys() ?? [])]; }

  write(anchor: string, values: readonly (readonly Scalar[])[], blocked: (address: string) => boolean): SpillWrite {
    if (!values.length || !values[0]?.length) throw new Error("#CALC!");
    const width = values[0].length;
    if (values.some((row) => row.length !== width)) throw new Error("#CALC!");
    const origin = parseAddress(anchor);
    const next = new Map<string, Scalar>();
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        next.set(addressKey({ row: origin.row + rowOffset, column: origin.column + columnOffset }), value);
      });
    });
    for (const address of next.keys()) {
      const existingOwner = this.#owners.get(address);
      if (address !== anchor && existingOwner !== anchor && blocked(address)) throw new Error("#SPILL!");
    }
    this.clearAnchor(anchor);
    this.#ranges.set(anchor, next);
    for (const address of next.keys()) this.#owners.set(address, anchor);
    return next;
  }

  clearAnchor(anchor: string): readonly string[] {
    const range = this.#ranges.get(anchor);
    if (!range) return [];
    for (const address of range.keys()) this.#owners.delete(address);
    this.#ranges.delete(anchor);
    return [...range.keys()];
  }

  clearAt(address: string): Readonly<{ owner: string; addresses: readonly string[] }> | undefined {
    const owner = this.#owners.get(address);
    if (!owner) return undefined;
    return { owner, addresses: this.clearAnchor(owner) };
  }
}
