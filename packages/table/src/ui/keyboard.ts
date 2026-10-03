/**
 * COMP-02.5 — grid keyboard model.
 *
 * The grid is a single tab stop: arrows move between cells and Tab walks right
 * through the row. At the last column Tab is handed back to the browser so
 * focus leaves the grid (never trapped); Shift+Tab mirrors it at column 0.
 * The decision is isolated here so it is unit-testable without a DOM.
 */
export type TabIntent = "move" | "leave";

export function tabIntent({ shiftKey, column, columnCount }: Readonly<{ shiftKey: boolean; column: number; columnCount: number }>): TabIntent {
  if (shiftKey) return column > 0 ? "move" : "leave";
  return column < columnCount - 1 ? "move" : "leave";
}

const TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hand focus to the page element before/after the grid, so "leave" really
 * leaves — the grid carries tabbable chrome (resize handles, sort buttons) that
 * a plain default-tab from the container would land on.
 */
export function focusOutsideGrid(grid: HTMLElement, backwards: boolean): boolean {
  if (typeof document === "undefined") return false;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((element) => !grid.contains(element));
  const target = backwards
    ? candidates.filter((element) => (grid.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0).at(-1)
    : candidates.find((element) => (grid.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  if (!target) return false;
  target.focus();
  return true;
}
