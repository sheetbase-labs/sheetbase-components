import type { CellChange } from "./mutations";

const deleted = Symbol("deleted-cell");
type StoredValue = string | typeof deleted;

/** Persistent sparse cell storage with cheap copy-on-write overlays. */
export class CellStore implements ReadonlyMap<string, string> {
  readonly #parent: ReadonlyMap<string, string> | null;
  readonly #changes: ReadonlyMap<string, StoredValue>;
  readonly #depth: number;
  #materialized?: Map<string, string>;

  private constructor(
    parent: ReadonlyMap<string, string> | null,
    changes: ReadonlyMap<string, StoredValue>,
    depth: number,
  ) {
    this.#parent = parent;
    this.#changes = changes;
    this.#depth = depth;
  }

  static from(values: ReadonlyMap<string, string>): CellStore {
    return values instanceof CellStore ? values : new CellStore(values, new Map(), 0);
  }

  apply(changes: readonly CellChange[], direction: "forward" | "backward" = "forward"): CellStore {
    if (changes.length === 0) return this;
    const overlay = new Map<string, StoredValue>();
    for (const change of changes) {
      const value = direction === "forward" ? change.after : change.before;
      overlay.set(change.address, value === undefined ? deleted : value);
    }
    if (this.#depth >= 64) return new CellStore(this.materialize(), overlay, 1);
    return new CellStore(this, overlay, this.#depth + 1);
  }

  get size(): number { return this.materialize().size; }

  get(key: string): string | undefined {
    if (this.#changes.has(key)) {
      const value = this.#changes.get(key);
      return value === deleted ? undefined : value;
    }
    return this.#parent?.get(key);
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  entries(): MapIterator<[string, string]> { return this.materialize().entries(); }
  keys(): MapIterator<string> { return this.materialize().keys(); }
  values(): MapIterator<string> { return this.materialize().values(); }
  [Symbol.iterator](): MapIterator<[string, string]> { return this.entries(); }

  forEach(callbackfn: (value: string, key: string, map: ReadonlyMap<string, string>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this);
  }

  materialize(): Map<string, string> {
    if (this.#materialized) return this.#materialized;
    const result = this.#parent ? new Map(this.#parent) : new Map<string, string>();
    for (const [key, value] of this.#changes) {
      if (value === deleted) result.delete(key); else result.set(key, value);
    }
    this.#materialized = result;
    return result;
  }
}
