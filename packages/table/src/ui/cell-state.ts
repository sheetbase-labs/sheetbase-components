/**
 * COMP-02.3 — per-cell states.
 *
 * A host answers `Spreadsheet.cellState(row, column)` with one of the v3 grid
 * states. The simple states are bare strings; `conflict` and `diff` carry the
 * data the design paints ("2 values", the before/after of a changed value).
 * Styling lives in `styles/grid.css` and reads only theme variables, so the
 * v3 preset retheme everything from `themes/v3.css`.
 *
 * Rendering is split so the states are unit-testable without a DOM: this module
 * owns resolution/labelling/comparison, the grid components own paint.
 */
export type CellStateName =
  | "invalid"
  | "flagged"
  | "pending"
  | "derived"
  | "readonly"
  | "unsynced"
  | "conflict"
  | "diff";

/** Simple states, or the two that carry data. */
export type CellState =
  | Exclude<CellStateName, "conflict" | "diff">
  | Readonly<{ state: "conflict"; count: number }>
  | Readonly<{ state: "diff"; before?: string; after: string }>;

/** Flattened, render-ready state — what the grid and its cells consume. */
export type ResolvedCellState = Readonly<{
  state: CellStateName;
  count?: number;
  before?: string;
  after?: string;
}>;

export function resolveCellState(state: CellState | undefined | null): ResolvedCellState | undefined {
  if (state === undefined || state === null) return undefined;
  if (typeof state === "string") return { state };
  if (state.state === "conflict") return { state: "conflict", count: state.count };
  return { state: "diff", before: state.before, after: state.after };
}

/** The class the grid paints for a state, or "" when there is none. */
export function cellStateClassName(state: ResolvedCellState | undefined): string {
  return state ? ` cell-${state.state}` : "";
}

/** Human/assistive label for a state (`title`/`aria-label` text). */
export function cellStateLabel(state: ResolvedCellState | undefined): string | undefined {
  if (!state) return undefined;
  switch (state.state) {
    case "invalid": return "Invalid value";
    case "flagged": return "Flagged value";
    case "pending": return "Pending value";
    case "derived": return "Derived value";
    case "readonly": return "Read-only value";
    case "unsynced": return "Unsynced local edit";
    case "conflict": return `${conflictValueLabel(state.count ?? 2)} in conflict`;
    case "diff": return "Changed value";
  }
}

/** The design's "2 values" wording for a conflicted cell. */
export function conflictValueLabel(count: number): string {
  return `${count} value${count === 1 ? "" : "s"}`;
}

/** Value change text for a `diff` cell; a missing `before` means an addition. */
export function diffText(state: ResolvedCellState | undefined): string | undefined {
  if (state?.state !== "diff") return undefined;
  return state.before !== undefined ? `${state.before} → ${state.after}` : state.after;
}

export function sameCellState(a: ResolvedCellState | undefined, b: ResolvedCellState | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.state === b.state && a.count === b.count && a.before === b.before && a.after === b.after;
}
