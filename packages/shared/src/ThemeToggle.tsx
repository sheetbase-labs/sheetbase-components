import { useState } from "react";
export type ThemeMode = "light" | "dark";

/** Shared localStorage key so schema/rules/search agree on next mount. Table + explorer keep their own persisted states. */
export const SHARED_THEME_STORAGE_KEY = "sheetbase:theme";

/** Uncontrolled theme state with localStorage persistence. Controlled (`theme` defined) disables internal writes; the host owns persistence via `onThemeChange`. */
export function usePersistedTheme({ theme, defaultTheme = "light", onThemeChange, storageKey = SHARED_THEME_STORAGE_KEY }: {
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
  /** Pass `undefined` to keep the theme ephemeral (no localStorage). */
  storageKey?: string;
}): { activeTheme: ThemeMode; toggleTheme(): void } {
  const [innerTheme, setInnerTheme] = useState<ThemeMode>(() => {
    if (theme !== undefined || !storageKey || typeof localStorage === "undefined") return defaultTheme;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === "dark" || stored === "light" ? stored : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const activeTheme = theme ?? innerTheme;
  function toggleTheme() {
    const next = activeTheme === "dark" ? "light" : "dark";
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
  return { activeTheme, toggleTheme };
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

/** Explorer-style sun/moon toggle for the topbar. */
export function ThemeToggleButton({ theme, onToggle }: { theme: ThemeMode; onToggle(): void }) {
  const dark = theme === "dark";
  return (
    <button
      className="sb-icon-btn sb-theme-btn"
      title={dark ? "Light mode" : "Dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={onToggle}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
