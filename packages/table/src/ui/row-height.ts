import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Row height in px for the package's default (non-v3) preset — the value
 * `theme.css` sets on `--row-height`. The v3 preset overrides the variable to
 * 28px, so hosts get 28px rows without passing a JS prop (COMP-02.1).
 */
export const DEFAULT_ROW_HEIGHT = 31;

/** React's layout-effect contract on the server is undefined; use passive there. */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Parse a CSS length for `--row-height`. Only bare numbers and `px` are
 * accepted; anything else (`calc(...)`, `rem`, empty) falls back rather than
 * guessing, so a malformed variable cannot collapse or explode the grid.
 */
export function rowHeightFromCss(value: string | null | undefined, fallback: number = DEFAULT_ROW_HEIGHT): number {
  if (typeof value !== "string") return fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  if (!match) return fallback;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Track the row height a themed host asks for through `--row-height`.
 *
 * Returns `fallback` until the element is measured (and on the server), then
 * re-reads whenever the element's attributes change so a host swapping
 * presets or themes retints the grid without a JS prop.
 */
export function useThemeRowHeight(ref: RefObject<HTMLElement | null>, fallback: number = DEFAULT_ROW_HEIGHT): number {
  const [height, setHeight] = useState(fallback);
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof getComputedStyle !== "function") return;
    const read = () => setHeight(rowHeightFromCss(getComputedStyle(element).getPropertyValue("--row-height"), fallback));
    read();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(read);
    // Only preset/theme switches can change `--row-height`; watching every
    // attribute would re-read computed style on each scroll (`--sheet-scroll-*`
    // is written to the style attribute).
    observer.observe(element, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, [ref, fallback]);
  return height;
}

/**
 * Re-bake an auto row height into a `rowHeights` array after the theme's
 * measured height arrives. Only rows still holding `previous` are rewritten;
 * explicit heights from `initialRowHeights`/`initialState` and hand resizes
 * (both `explicit`) keep their value, as do hidden rows (`0`).
 *
 * Returns the same array when nothing changes so the caller's `setState`
 * bails out.
 */
export function rebaseAutoRowHeights(
  heights: number[],
  previous: number,
  next: number,
  explicit?: (row: number) => number | undefined,
): number[] {
  if (previous === next) return heights;
  let changed = false;
  const rebased = heights.map((height, row) => {
    if (height !== previous || explicit?.(row) !== undefined) return height;
    changed = true;
    return next;
  });
  return changed ? rebased : heights;
}
