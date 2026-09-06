import RBush from "rbush";
import { normalizeRange } from "./coordinates";
import type { CellAddress, CellRange } from "./types";

type IndexedRectangle<T> = {
  id: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  value: T;
};

type Box = Pick<IndexedRectangle<never>, "minX" | "minY" | "maxX" | "maxY">;

function sameValue<T>(a: T, b: T): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Canonical last-write-wins range storage inspired by Equals' published design:
 * statically-shaped rectangles in a Map plus an R-tree intersection index.
 */
export class RangeStore<T> {
  readonly #rectangles = new Map<number, IndexedRectangle<T>>();
  readonly #index = new RBush<IndexedRectangle<T>>();
  #nextId = 1;
  readonly #equals: (a: T, b: T) => boolean;

  constructor(equals: (a: T, b: T) => boolean = sameValue) {
    this.#equals = equals;
  }

  get size(): number {
    return this.#rectangles.size;
  }

  entries(): readonly { range: CellRange; value: T }[] {
    return [...this.#rectangles.values()].map((rectangle) => ({
      range: {
        start: { row: rectangle.minY, column: rectangle.minX },
        end: { row: rectangle.maxY, column: rectangle.maxX },
      },
      value: rectangle.value,
    }));
  }

  clone(): RangeStore<T> {
    const copy = new RangeStore<T>(this.#equals);
    for (const entry of this.entries()) copy.write(entry.range, entry.value);
    return copy;
  }

  get(point: CellAddress): T | undefined {
    return this.#index.search({
      minX: point.column,
      minY: point.row,
      maxX: point.column,
      maxY: point.row,
    })[0]?.value;
  }

  query(range: CellRange): readonly { range: CellRange; value: T }[] {
    const box = this.#box(range);
    return this.#index.search(box).map((rectangle) => ({
      range: {
        start: { row: rectangle.minY, column: rectangle.minX },
        end: { row: rectangle.maxY, column: rectangle.maxX },
      },
      value: rectangle.value,
    }));
  }

  write(range: CellRange, value: T): void {
    const incoming = this.#box(range);
    const overlaps = this.#index.search(incoming);
    const seeds: IndexedRectangle<T>[] = [];
    for (const rectangle of overlaps) {
      this.#remove(rectangle);
      for (const remainder of this.#subtract(rectangle, incoming)) {
        this.#insert(remainder);
        seeds.push(remainder);
      }
    }
    const inserted = { ...incoming, id: this.#nextId++, value };
    this.#insert(inserted);
    seeds.push(inserted);
    for (const seed of seeds) {
      if (this.#rectangles.has(seed.id)) this.#consolidateFrom(seed);
    }
  }

  #box(range: CellRange): Box {
    const normalized = normalizeRange(range);
    return {
      minX: normalized.start.column,
      minY: normalized.start.row,
      maxX: normalized.end.column,
      maxY: normalized.end.row,
    };
  }

  #insert(rectangle: IndexedRectangle<T>): void {
    this.#rectangles.set(rectangle.id, rectangle);
    this.#index.insert(rectangle);
  }

  #remove(rectangle: IndexedRectangle<T>): void {
    this.#rectangles.delete(rectangle.id);
    this.#index.remove(rectangle, (a, b) => a.id === b.id);
  }

  #subtract(source: IndexedRectangle<T>, cut: Box): IndexedRectangle<T>[] {
    const pieces: IndexedRectangle<T>[] = [];
    const add = (minX: number, minY: number, maxX: number, maxY: number) => {
      if (minX <= maxX && minY <= maxY) {
        pieces.push({ id: this.#nextId++, minX, minY, maxX, maxY, value: source.value });
      }
    };
    add(source.minX, source.minY, source.maxX, cut.minY - 1);
    add(source.minX, cut.maxY + 1, source.maxX, source.maxY);
    const middleTop = Math.max(source.minY, cut.minY);
    const middleBottom = Math.min(source.maxY, cut.maxY);
    add(source.minX, middleTop, cut.minX - 1, middleBottom);
    add(cut.maxX + 1, middleTop, source.maxX, middleBottom);
    return pieces;
  }

  #consolidateFrom(seed: IndexedRectangle<T>): void {
    let current = seed;
    while (this.#rectangles.has(current.id)) {
      const candidates = this.#index.search({
        minX: current.minX - 1,
        minY: current.minY - 1,
        maxX: current.maxX + 1,
        maxY: current.maxY + 1,
      });
      const neighbour = candidates.find((candidate) => {
        if (candidate.id === current.id || !this.#equals(current.value, candidate.value)) return false;
        const vertical = current.minX === candidate.minX && current.maxX === candidate.maxX &&
          (current.maxY + 1 === candidate.minY || candidate.maxY + 1 === current.minY);
        const horizontal = current.minY === candidate.minY && current.maxY === candidate.maxY &&
          (current.maxX + 1 === candidate.minX || candidate.maxX + 1 === current.minX);
        return vertical || horizontal;
      });
      if (!neighbour) return;
      this.#remove(current);
      this.#remove(neighbour);
      current = {
        id: this.#nextId++,
        minX: Math.min(current.minX, neighbour.minX),
        minY: Math.min(current.minY, neighbour.minY),
        maxX: Math.max(current.maxX, neighbour.maxX),
        maxY: Math.max(current.maxY, neighbour.maxY),
        value: current.value,
      };
      this.#insert(current);
    }
  }
}
