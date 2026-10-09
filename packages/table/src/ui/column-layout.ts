/**
 * Column layout maths: the initial display order for a host-supplied column
 * list, and the width distribution that stretches columns to the viewport.
 *
 * Both are pure so the layout decisions are unit-testable without a DOM; the
 * component only measures the container and renders the result.
 */

/** How slack container width is distributed across columns. */
export type ColumnStretch = "none" | "last" | "all";

/**
 * Order `columns` by the stable ids in `order` — the initial display order a
 * host persists. Ids missing from `columns` are dropped, duplicates are
 * ignored, and columns not named by `order` keep their relative order after the
 * ordered ones. An empty/absent `order` returns the input order unchanged.
 *
 * The grid itself is positional (`fieldIds[i]`, `datasetHeader.fields[].column`
 * and cell addresses all index the same column), so the display order is
 * expressed by the array the host builds; this helper applies a saved order
 * without re-deriving the mapping.
 */
export function orderColumnsById<T extends { id: string }>(
  columns: readonly T[],
  order?: readonly string[],
): T[] {
  if (!order || order.length === 0) return [...columns];
  const byId = new Map(columns.map((column) => [column.id, column] as const));
  const ordered: T[] = [];
  const used = new Set<string>();
  for (const id of order) {
    if (used.has(id)) continue;
    const column = byId.get(id);
    if (!column) continue;
    used.add(id);
    ordered.push(column);
  }
  for (const column of columns) {
    if (!used.has(column.id)) ordered.push(column);
  }
  return ordered;
}

/**
 * Distribute `available` px of column space across `widths`.
 *
 * `"none"` returns the configured widths untouched; `"last"` gives the whole
 * slack to the last visible column; `"all"` shares it equally across visible
 * columns. Hidden columns (`width === 0`) stay hidden. When the columns already
 * overflow `available` (or nothing is available), the configured widths win —
 * stretching never shrinks a column below its configured width.
 */
export function stretchColumnWidths(
  widths: readonly number[],
  available: number,
  mode: ColumnStretch,
): number[] {
  if (mode === "none" || widths.length === 0 || !(available > 0)) return [...widths];
  const base = widths.reduce((sum, width) => sum + width, 0);
  const slack = available - base;
  if (!(slack > 0)) return [...widths];
  const next = [...widths];
  if (mode === "last") {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index] > 0) {
        next[index] += slack;
        return next;
      }
    }
    return next;
  }
  const visible = next.reduce<number[]>((indices, width, index) => {
    if (width > 0) indices.push(index);
    return indices;
  }, []);
  if (visible.length === 0) return next;
  const each = slack / visible.length;
  for (const index of visible) next[index] += each;
  return next;
}
