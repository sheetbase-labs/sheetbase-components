/**
 * COMP-02.4 — the "New run" append row.
 *
 * The grid draws one extra row after the last populated row. Clicking it (or
 * typing in it) starts a draft; committing that draft runs the existing
 * blank-row path in `Spreadsheet.finishEdit`, which calls `onRecordCreate`.
 * Kept DOM-free here so the index/label rules are unit-testable.
 */
import { usedRangeBounds } from "../grid/model";

export const APPEND_ROW_LABEL = "New run — type a condition or paste rows";

export type AppendRowConfig = boolean | Readonly<{ label?: string }>;

/** Whether the append row is requested at all. */
export function appendRowEnabled(config: AppendRowConfig | undefined): boolean {
  return config !== undefined && config !== false;
}

/** The row's placeholder copy, defaulting to the design wording. */
export function appendRowLabel(config: AppendRowConfig | undefined): string {
  if (config && typeof config === "object" && typeof config.label === "string" && config.label !== "") return config.label;
  return APPEND_ROW_LABEL;
}

/**
 * Index of the append row: one past the last populated row, or 0 for an empty
 * sheet. `undefined` when the row is disabled. Hosts must pass a `rowCount`
 * large enough to contain it (all bundled demos do).
 */
export function appendRowIndex(
  data: ReadonlyMap<string, string>,
  config: AppendRowConfig | undefined,
): number | undefined {
  if (!appendRowEnabled(config)) return undefined;
  const bounds = usedRangeBounds(data);
  return bounds ? bounds.bottom + 1 : 0;
}

/** First column a draft can be typed into — the first writable field, else 0. */
export function firstWritableColumn(fields: readonly Readonly<{ column: number; writable?: boolean }>[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const field of fields) {
    if (field.writable === false) continue;
    if (field.column < first) first = field.column;
  }
  return Number.isFinite(first) ? first : 0;
}
