import type { GridPoint, GridSelection } from "../grid/model";

/**
 * Imperative focus/selection maths for the grid handle. The component owns the
 * DOM (`scrollToIndex`, `focus()`); the clamping and selection shape live here
 * so hosts and tests can reason about them without a DOM.
 *
 * Coordinates are *displayed* coordinates: under a local sort/filter view a
 * displayed row is not the stored row, so callers that hold a stored address
 * resolve it through the same view mapping the renderer uses.
 */

/** Clamp a coordinate into the addressable grid, both bounds inclusive, never negative. */
export function clampGridPoint(point: GridPoint, rowCount: number, columnCount: number): GridPoint {
  const lastRow = Math.max(0, Math.trunc(rowCount) - 1);
  const lastColumn = Math.max(0, Math.trunc(columnCount) - 1);
  return {
    row: Math.min(Math.max(0, Math.trunc(point.row)), lastRow),
    column: Math.min(Math.max(0, Math.trunc(point.column)), lastColumn),
  };
}

/**
 * The selection after selecting `point`: collapse to it, or extend from the
 * current anchor (Shift-click / Shift-arrow semantics).
 */
export function selectionForPoint(current: GridSelection, point: GridPoint, extend = false): GridSelection {
  return extend ? { anchor: current.anchor, focus: point } : { anchor: point, focus: point };
}
