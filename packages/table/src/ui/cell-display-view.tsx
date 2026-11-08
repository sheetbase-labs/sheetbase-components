import type { CSSProperties, ReactNode } from "react";
import { type CellDisplayModel, type CellDisplaySpec, type CellDisplayTone, cellDisplayModel } from "./cell-display";

const TONE: Record<CellDisplayTone, { fg: string; bg: string }> = {
  neutral: { fg: "var(--muted)", bg: "var(--panel-2)" },
  success: { fg: "var(--green-text, var(--green))", bg: "var(--green-soft)" },
  warning: { fg: "var(--orange-text, var(--orange))", bg: "var(--orange-soft)" },
  danger: { fg: "var(--danger-text, var(--danger))", bg: "var(--danger-soft)" },
  info: { fg: "var(--blue)", bg: "color-mix(in oklab, var(--blue) 14%, var(--panel))" },
};

const BASE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", whiteSpace: "nowrap" };

function Sparkline({ values, tone }: { values: number[]; tone: CellDisplayTone }) {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const w = 64;
  const h = 16;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg role="img" aria-label={values.join(", ")} viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <polyline points={points} fill="none" stroke={TONE[tone].fg} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Draws a display model. `sanitizeSvg` is the host's cleaner; without one an svg display shows nothing. */
export function renderCellDisplayModel(model: CellDisplayModel, sanitizeSvg?: (svg: string) => string | null): ReactNode {
  switch (model.kind) {
    case "empty":
      return null;
    case "text":
      return <span style={{ ...BASE, fontFamily: model.mono ? "var(--mono, ui-monospace, monospace)" : undefined }}>{model.text}</span>;
    case "badge":
      return (
        <span style={{ ...BASE, padding: "0 8px", borderRadius: 999, fontSize: 12, lineHeight: "18px", color: TONE[model.tone].fg, background: TONE[model.tone].bg }}>
          {model.text}
        </span>
      );
    case "bar":
      return (
        <span role="meter" aria-valuenow={Math.round(model.fraction * 100)} aria-valuemin={0} aria-valuemax={100} style={BASE}>
          <span style={{ width: 80, height: 6, borderRadius: 999, overflow: "hidden", background: "var(--panel-2)", flex: "none" }}>
            <span style={{ display: "block", height: "100%", width: `${model.fraction * 100}%`, borderRadius: 999, background: TONE[model.tone].fg }} />
          </span>
          {model.label ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{model.label}</span> : null}
        </span>
      );
    case "sparkline":
      return <Sparkline values={model.values} tone={model.tone} />;
    case "svg": {
      const clean = sanitizeSvg?.(model.svg);
      // biome-ignore lint/security/noDangerouslySetInnerHtml: only markup the host's own cleaner returned
      return clean ? <span style={{ ...BASE, height: 20 }} dangerouslySetInnerHTML={{ __html: clean }} /> : null;
    }
  }
}

export function renderCellDisplay(spec: CellDisplaySpec, value: unknown, sanitizeSvg?: (svg: string) => string | null): ReactNode {
  return renderCellDisplayModel(cellDisplayModel(spec, value), sanitizeSvg);
}
