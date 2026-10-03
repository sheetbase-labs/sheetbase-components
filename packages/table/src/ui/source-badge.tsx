import type { ReactNode } from "react";

/**
 * Where a column's values come from (COMP-02.2) — the `kind` of the design's
 * `Sheetbase.Source`. Styling and labels follow
 * `design-system/components/Source/README.md`.
 */
export type ColumnSource = "dataset" | "record" | "calc" | "local";

/** Design bundle icon per source kind (`SRC`: database, link, code, edit). */
const SOURCE_ICONS: Record<ColumnSource, ReactNode> = {
  dataset: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="1.8" />
      <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
    </>
  ),
  record: <path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" />,
  calc: <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" />,
  local: <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />,
};

/** A calculated column reads "ƒx" when the host gives no explicit label. */
export const CALC_SOURCE_LABEL = "ƒx";

/**
 * The badge text for a source: the host's label when present, otherwise "ƒx"
 * for calculated columns and nothing (icon only) for the rest.
 */
export function sourceBadgeLabel(source: ColumnSource | undefined, label?: string): string | undefined {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  return source === "calc" ? CALC_SOURCE_LABEL : undefined;
}

/**
 * The `fx` mark is redundant when the `Source` badge already reads "ƒx" — the
 * design shows one calculation mark per header.
 */
export function showsComputedMark(computed: boolean, source?: ColumnSource, label?: string): boolean {
  if (!computed) return false;
  return sourceBadgeLabel(source, label) !== CALC_SOURCE_LABEL;
}

/** The design's `Sheetbase.Source`: kind class, icon, and label. */
export function SourceBadge({ source, label }: Readonly<{ source: ColumnSource; label?: string }>) {
  const text = sourceBadgeLabel(source, label);
  return (
    <span className={`src ${source}`} title={text}>
      <svg width={10} height={10} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {SOURCE_ICONS[source]}
      </svg>
      {text}
    </span>
  );
}
