import { useEffect, useState } from "react";
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Shared localStorage key so schema/rules/search agree on next mount. Table + explorer keep their own persisted states. */
export const SHARED_THEME_STORAGE_KEY = "sheetbase:theme";

/** Resolve a stored mode to a concrete theme; system reads the OS preference live. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/** Resolved theme that tracks the OS preference while the mode is system. */
export function useResolvedTheme(mode: ThemeMode): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));
  useEffect(() => {
    setResolved(resolveTheme(mode));
    if (mode !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(query.matches ? "dark" : "light");
    // MediaQueryList.addEventListener is the modern API; older Safari (and
    // thin test mocks) only carry addListener.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    if (typeof query.addListener === "function") {
      query.addListener(update);
      return () => query.removeListener(update);
    }
    return undefined;
  }, [mode]);
  return resolved;
}

/**
 * Uncontrolled theme state with localStorage persistence. Controlled (`theme` defined) disables internal writes; the host owns persistence via `onThemeChange`.
 * `activeTheme` is the stored mode (may be "system"); `resolvedTheme` is the concrete light/dark to apply. Toggling from system lands on the opposite of the current resolved value.
 */
export function usePersistedTheme({ theme, defaultTheme = "light", onThemeChange, storageKey = SHARED_THEME_STORAGE_KEY }: {
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
  /** Pass `undefined` to keep the theme ephemeral (no localStorage). */
  storageKey?: string;
}): { activeTheme: ThemeMode; resolvedTheme: ResolvedTheme; toggleTheme(): void } {
  const [innerTheme, setInnerTheme] = useState<ThemeMode>(() => {
    if (theme !== undefined || !storageKey || typeof localStorage === "undefined") return defaultTheme;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === "dark" || stored === "light" || stored === "system" ? stored : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const activeTheme = theme ?? innerTheme;
  const resolvedTheme = useResolvedTheme(activeTheme);
  function toggleTheme() {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    if (theme === undefined) {
      setInnerTheme(next);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          // Persistence is optional; a full quota must never break the toggle.
        }
      }
    }
    onThemeChange?.(next);
  }
  return { activeTheme, resolvedTheme, toggleTheme };
}

export function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

/** Explorer-style sun/moon toggle for the topbar. Flips light/dark; under `system` it shows the resolved theme and the flip leaves system mode. */
export function ThemeToggleButton({ theme, onToggle }: { theme: ThemeMode; onToggle(): void }) {
  const dark = useResolvedTheme(theme) === "dark";
  return (
    <button type="button"
      className="sb-icon-btn sb-theme-btn"
      title={dark ? "Light mode" : "Dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={onToggle}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
