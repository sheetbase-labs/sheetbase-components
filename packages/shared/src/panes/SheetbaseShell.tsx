import type { ReactNode } from "react";
import { ThemeToggleButton, type ThemeMode } from "../ThemeToggle";

export interface SheetbaseShellProps {
  /** Active theme. Drives both the scope tokens and the built-in toggle icon. */
  theme: ThemeMode;
  /** Left cluster: brand, title or toolbar. */
  toolbar?: ReactNode;
  /** Right cluster, placed before the theme toggle. */
  actions?: ReactNode;
  /** Secondary indigo action band under the topbar. */
  subbar?: ReactNode;
  /** Renders the shared theme toggle when provided. */
  onToggleTheme?: () => void;
  /** Draw the framed card (`.sb-frame`). Set false to nest inside an existing shell. Default true. */
  frame?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The shared application frame: topbar, optional subbar and a fill-height body.
 * Wraps the same `.sb-frame` / `.sb-topbar` / `.sb-subbar` primitives the
 * individual components already use, so a host can seat any mix of them in
 * consistent chrome.
 */
export function SheetbaseShell({
  theme,
  toolbar,
  actions,
  subbar,
  onToggleTheme,
  frame = true,
  className,
  bodyClassName,
  children,
}: SheetbaseShellProps) {
  const chrome = (
    <>
      <div className="sb-topbar">
        {toolbar}
        <div className="sb-topbar-actions">
          {actions}
          {onToggleTheme && <ThemeToggleButton theme={theme} onToggle={onToggleTheme} />}
        </div>
      </div>
      {subbar && <div className="sb-subbar sb-shell-subbar">{subbar}</div>}
      <div className={cx("sb-shell-body", bodyClassName)}>{children}</div>
    </>
  );
  return (
    <div className={cx("sheetbase-scope", "sb-shell", className)} data-theme={theme}>
      {frame ? (
        <div className={cx("sb-frame", "sb-shell-frame", subbar ? "has-subbar" : false)}>{chrome}</div>
      ) : (
        <div className="sb-shell-flat">{chrome}</div>
      )}
    </div>
  );
}
