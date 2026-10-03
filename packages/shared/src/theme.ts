/**
 * Runtime helpers for the themed colour variables (COMP-01).
 *
 * Most render paths take a `var(--token)` string directly — inline styles and
 * stylesheets resolve it. Two paths cannot: SVG presentation attributes (the
 * chart renderer) and `<input type="color">` values. Callers there read the
 * variable through `resolveThemeColour`, which returns the computed colour from
 * a live scope element so the same token works under the default preset and
 * `themes/v3.css`.
 */

/**
 * Resolve a themed CSS value. Non-`var(...)` values (including literal colours
 * a host has chosen) are returned unchanged; a missing variable keeps its
 * `var()` form so a later real render can still resolve it.
 */
export function resolveThemeColour(value: string, host?: Element | null): string {
  const scope = host ?? (typeof document === "undefined" ? null : document.querySelector(".sheetbase-scope, .sheetbase-explorer"));
  if (!value.startsWith("var(") || !scope || typeof getComputedStyle !== "function") return value;
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value);
  const name = match?.[1];
  if (!name) return value;
  const resolved = getComputedStyle(scope).getPropertyValue(name).trim();
  return resolved || match?.[2]?.trim() || value;
}

/** `resolveThemeColour` over a list; order is preserved. */
export function resolveThemeColours(values: readonly string[], host?: Element | null): string[] {
  return values.map((value) => resolveThemeColour(value, host));
}
