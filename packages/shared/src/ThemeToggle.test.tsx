import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, ThemeToggleButton, usePersistedTheme, type ThemeMode } from "./ThemeToggle";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches, addEventListener() {}, removeEventListener() {} }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("resolveTheme", () => {
  it("returns light/dark modes unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system from the OS preference", () => {
    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("falls back to light when matchMedia is unavailable", () => {
    expect(resolveTheme("system")).toBe("light");
  });
});

describe("usePersistedTheme", () => {
  function Probe(props: { theme?: ThemeMode; defaultTheme?: ThemeMode; storageKey?: string; onThemeChange?: (next: ThemeMode) => void }) {
    const { activeTheme, resolvedTheme, toggleTheme } = usePersistedTheme(props);
    return (
      <output
        data-active={activeTheme}
        data-resolved={resolvedTheme}
        onClick={toggleTheme}
      />
    );
  }

  it("reports the resolved theme alongside the mode", () => {
    stubMatchMedia(true);
    const html = renderToStaticMarkup(<Probe theme="system" />);
    expect(html).toContain('data-active="system"');
    expect(html).toContain('data-resolved="dark"');
  });

  it("round-trips a stored system value", () => {
    stubMatchMedia(false);
    vi.stubGlobal("localStorage", {
      getItem: () => "system",
      setItem() {},
    });
    const html = renderToStaticMarkup(<Probe storageKey="sheetbase:test-theme" />);
    expect(html).toContain('data-active="system"');
    expect(html).toContain('data-resolved="light"');
  });

  it("toggles from system to the opposite of the resolved value", () => {
    stubMatchMedia(true);
    const changes: ThemeMode[] = [];
    renderToStaticMarkup(<Probe theme="system" onThemeChange={(next) => changes.push(next)} />);
    // jsdom-less SSR never fires the click; drive the toggle directly instead.
    let toggle!: () => void;
    function Capturing() {
      const { toggleTheme } = usePersistedTheme({ theme: "system", onThemeChange: (next) => changes.push(next) });
      toggle = toggleTheme;
      return null;
    }
    renderToStaticMarkup(<Capturing />);
    toggle();
    expect(changes).toEqual(["light"]);
  });
});

describe("ThemeToggleButton", () => {
  it("renders the resolved icon under system", () => {
    stubMatchMedia(true);
    const html = renderToStaticMarkup(<ThemeToggleButton theme="system" onToggle={() => {}} />);
    expect(html).toContain('aria-label="Switch to light mode"');
  });
});
