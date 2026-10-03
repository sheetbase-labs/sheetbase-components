import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { resolveThemeColour, resolveThemeColours } from "sheetbase-shared";
import type { CellFormat, CellRange } from "../engine";
import { usePortalPopover } from "./use-portal-popover";
import type { ConditionalFormatOperator, ConditionalFormatRule } from "../grid/conditional-formatting";
import type { ThemeMode } from "./presentation-state";

export type TableSurfaceProps = Readonly<{
  table: ReactNode;
  companion?: ReactNode;
  companionWidth?: number;
  className?: string;
  action?: ReactNode;
  theme?: "light" | "dark";
  objects?: readonly TableSurfaceObject[];
  /**
   * Draw the surface frame (border, surround, companion layout). Default true
   * for the Million-style wrapper; false renders just the table, e.g. Bare.
   */
  frame?: boolean;
}>;

export type TableSurfaceObject = Readonly<{
  id: string;
  placement: "right" | "bottom";
  size: number;
  content: ReactNode;
  onResize?(size: number): void;
}>;

function resizeWithKeys(object: TableSurfaceObject) {
  return (event: React.KeyboardEvent) => {
    const grow = object.placement === "right" ? event.key === "ArrowLeft" : event.key === "ArrowDown";
    const shrink = object.placement === "right" ? event.key === "ArrowRight" : event.key === "ArrowUp";
    if (!grow && !shrink) return;
    event.preventDefault();
    object.onResize?.(Math.max(220, Math.min(520, object.size + (grow ? 16 : -16))));
  };
}
function startResize(event: React.PointerEvent, object: TableSurfaceObject) {
  event.preventDefault();
  const start = object.placement === "right" ? event.clientX : event.clientY;
  const initial = object.size;
  const move = (next: PointerEvent) => {
    const delta = object.placement === "right" ? start - next.clientX : start - next.clientY;
    object.onResize?.(Math.max(220, Math.min(520, initial + delta)));
  };
  const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
}

/** A compact work surface that can grow to hold table-adjacent tools and charts. */
export function TableSurface({ table, companion, companionWidth = 292, className = "", action, theme = "light", objects = [], frame = true }: TableSurfaceProps) {
  if (!frame) return <>{table}</>;
  const resolvedObjects = objects.length > 0 ? objects : companion ? [{ id: "companion", placement: "right" as const, size: companionWidth, content: companion }] : [];
  const rightObject = resolvedObjects.find((object) => object.placement === "right");
  const bottomObject = resolvedObjects.find((object) => object.placement === "bottom");
  return <section
    className={`sheetbase-scope table-surface${rightObject ? " with-companion with-right-object" : ""}${bottomObject ? " with-bottom-object" : ""}${className ? ` ${className}` : ""}`}
    style={{ "--table-companion-width": `${rightObject?.size ?? companionWidth}px`, "--table-bottom-height": `${bottomObject?.size ?? 240}px` } as CSSProperties}
    data-theme={theme}
  >
    <div className="table-surface-table">{table}</div>
    {resolvedObjects.length === 0 && action && <div className="table-surface-action">{action}</div>}
    {rightObject && <aside className="table-surface-companion table-surface-object" data-object-id={rightObject.id}><hr className="surface-resizer horizontal" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={rightObject.size} aria-valuemin={220} aria-valuemax={520} tabIndex={0} onPointerDown={(event) => startResize(event, rightObject)} onKeyDown={resizeWithKeys(rightObject)} />{rightObject.content}</aside>}
    {bottomObject && <aside className="table-surface-bottom table-surface-object" data-object-id={bottomObject.id}><hr className="surface-resizer vertical" aria-orientation="horizontal" aria-label="Resize panel" aria-valuenow={bottomObject.size} aria-valuemin={220} aria-valuemax={520} tabIndex={0} onPointerDown={(event) => startResize(event, bottomObject)} onKeyDown={resizeWithKeys(bottomObject)} />{bottomObject.content}</aside>}
  </section>;
}

export type TableFormattingToolbarProps = Readonly<{
  selection: string;
  onFormat(format: Partial<CellFormat>): void;
  format?: Partial<CellFormat>;
  mixedFormats?: readonly (keyof CellFormat)[];
  theme?: "light" | "dark";
  /** Stored mode; the toggle cycles light → dark → system. Defaults to the resolved theme. */
  themeMode?: ThemeMode;
  onThemeChange?(mode: ThemeMode): void;
  viewControls?: ReactNode;
  /** Replaces the built-in light-mode colour palette. */
  colours?: readonly string[];
  /** Replaces the built-in dark-mode palette; falls back to `colours` when omitted. */
  darkColours?: readonly string[];
  defaultTextColour?: string;
  defaultFillColour?: string;
}>;

/** Direct formatting for the current cell, range, row or column selection. */
/**
 * Direct-formatting swatches, as theme tokens. Resolved to concrete colours
 * against the toolbar element so the same list themes light/dark and the v3
 * preset (see `themes/v3.css`); SVG and colour inputs need real colour values.
 */
const FORMAT_COLOUR_TOKENS = [
  "var(--format-colour-1)",
  "var(--format-colour-2)",
  "var(--format-colour-3)",
  "var(--format-colour-4)",
  "var(--format-colour-5)",
  "var(--format-colour-6)",
  "var(--format-colour-7)",
  "var(--format-colour-8)",
  "var(--format-colour-9)",
  "var(--format-colour-10)",
] as const;

function onSwatchKeys(event: React.KeyboardEvent<HTMLButtonElement>) {
  const swatches = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("button") ?? []);
  const columns = 5;
  const current = swatches.indexOf(document.activeElement as HTMLElement);
  if (current < 0 || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const offsets: Record<string, number> = { ArrowDown: columns, ArrowUp: -columns, ArrowLeft: -1, ArrowRight: 1 };
  const next = Math.max(0, Math.min(swatches.length - 1, current + (offsets[event.key] ?? 0)));
  swatches[next]?.focus();
}

function ColourPalette({ label, value, colours, theme, onChange }: Readonly<{ label: string; value?: string; colours: readonly string[]; theme: "light" | "dark"; onChange(value: string): void }>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  usePortalPopover(open, () => setOpen(false), { popover: paletteRef, trigger: buttonRef });
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !paletteRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const toggle = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (bounds) setPosition({ top: bounds.bottom + 5, left: bounds.left });
    setOpen((current) => !current);
  };
  const palette = <div
    ref={paletteRef}
    className="sheetbase-scope format-swatches"
    role="dialog"
    aria-label={`${label} palette`}
    data-theme={theme}
    style={position}
  >{colours.map((colour) => <button type="button" aria-label={`${label} ${colour}`} key={colour} style={{ background: colour }} onKeyDown={onSwatchKeys} onClick={() => { onChange(colour); setOpen(false); buttonRef.current?.focus(); }} />)}</div>;
  return <div className="format-palette"><button type="button" ref={buttonRef} className={open ? "active" : ""} aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}><span>{label === "Text colour" ? "A" : "▧"}</span><i style={value ? { background: value } : undefined} /></button>{open && typeof document !== "undefined" && createPortal(palette, document.body)}</div>;
}

export function TableFormattingToolbar({ selection, onFormat, format = {}, mixedFormats = [], theme = "light", themeMode = theme, onThemeChange, viewControls, colours, darkColours, defaultTextColour, defaultFillColour }: TableFormattingToolbarProps) {
  const [recentColours, setRecentColours] = useState<readonly string[]>([]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const builtInColours = useMemo(() => resolveThemeColours(FORMAT_COLOUR_TOKENS, host), [host]);
  const configuredColours = theme === "dark" ? darkColours ?? colours ?? builtInColours : colours ?? builtInColours;
  const paletteColours = [...recentColours, ...configuredColours].filter((colour, index, all) => all.indexOf(colour) === index);
  const applyColour = (property: "foreground" | "background", colour: string) => {
    setRecentColours((current) => [colour, ...current.filter((item) => item !== colour)].slice(0, 5));
    onFormat({ [property]: colour });
  };
  const mixed = (property: keyof CellFormat) => mixedFormats.includes(property);
  return <div ref={setHost} className="table-formatting-toolbar" role="toolbar" aria-label="Format selection">
    <span className="format-selection" title={selection}>{selection}</span>
    <span className="format-divider" />
    <button type="button" className={`${format.fontWeight && format.fontWeight >= 600 && !mixed("fontWeight") ? "active" : ""}${mixed("fontWeight") ? " mixed" : ""}`} aria-label="Bold" title="Bold" onClick={() => onFormat({ fontWeight: format.fontWeight && format.fontWeight >= 600 && !mixed("fontWeight") ? 400 : 600 })}>B</button>
    <ColourPalette label="Text colour" value={mixed("foreground") ? undefined : format.foreground ?? defaultTextColour ?? builtInColours[0]} colours={paletteColours} theme={theme} onChange={(colour) => applyColour("foreground", colour)} />
    <ColourPalette label="Fill colour" value={mixed("background") ? undefined : format.background ?? defaultFillColour ?? builtInColours[6]} colours={paletteColours} theme={theme} onChange={(colour) => applyColour("background", colour)} />
    <span className="format-divider" />
    <button type="button" className={format.horizontalAlign === "left" && !mixed("horizontalAlign") ? "active" : ""} aria-label="Align left" title="Align left" onClick={() => onFormat({ horizontalAlign: "left" })}>≡</button>
    <button type="button" className={format.horizontalAlign === "center" && !mixed("horizontalAlign") ? "active" : ""} aria-label="Align centre" title="Align centre" onClick={() => onFormat({ horizontalAlign: "center" })}>≣</button>
    <button type="button" aria-label="Align right" title="Align right" className={`align-right${format.horizontalAlign === "right" && !mixed("horizontalAlign") ? " active" : ""}`} onClick={() => onFormat({ horizontalAlign: "right" })}>≡</button>
    <select aria-label="Number format" value={mixed("numberFormat") ? "mixed" : format.numberFormat ?? "general"} onChange={(event) => onFormat({ numberFormat: event.target.value as CellFormat["numberFormat"] })}>
      <option value="mixed" disabled>Mixed</option><option value="general">General</option><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percent</option><option value="date">Date</option>
    </select>
    <span className="format-divider" />
    <button type="button" className="clear-format" onClick={() => onFormat({ foreground: undefined, background: undefined, fontWeight: undefined, horizontalAlign: undefined, numberFormat: "general" })}>Clear</button>
    {(viewControls || onThemeChange) && <span className="format-spacer" />}{viewControls}
    {onThemeChange && <button type="button" className="theme-toggle" aria-label={`Use ${themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light"} mode`} title={`Theme: ${themeMode}`} onClick={() => onThemeChange(themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light")}>{themeMode === "dark" ? "◑" : themeMode === "system" ? "☀" : "◐"}</button>}
  </div>;
}

const operatorLabels: Readonly<Record<ConditionalFormatOperator, string>> = {
  equals: "Equals",
  notEquals: "Does not equal",
  contains: "Contains",
  greaterThan: "Greater than",
  greaterThanOrEqual: "Greater than or equal",
  lessThan: "Less than",
  lessThanOrEqual: "Less than or equal",
  between: "Between",
  isBlank: "Is blank",
  isNotBlank: "Is not blank",
};

export type ConditionalFormattingInspectorProps = Readonly<{
  fieldId: string;
  fields?: readonly Readonly<{ id: string; label: string; options?: readonly string[] }>[];
  onFieldChange?(fieldId: string): void;
  selectionRange?: CellRange;
  selectionLabel?: string;
  rules: readonly ConditionalFormatRule[];
  onRulesChange(rules: readonly ConditionalFormatRule[]): void;
  onClose(): void;
}>;

export function ConditionalFormattingInspector({ fieldId, fields = [], onFieldChange, selectionRange, selectionLabel, rules, onRulesChange, onClose }: ConditionalFormattingInspectorProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const colours = useMemo(() => resolveThemeColours(FORMAT_COLOUR_TOKENS, host), [host]);
  const accentInk = useMemo(() => resolveThemeColour("var(--accent-ink)", host), [host]);
  const pastRules = useRef<readonly (readonly ConditionalFormatRule[])[]>([]);
  const futureRules = useRef<readonly (readonly ConditionalFormatRule[])[]>([]);
  const [, renderHistory] = useState(0);
  const commitRules = (next: readonly ConditionalFormatRule[]) => {
    pastRules.current = [...pastRules.current.slice(-49), rules];
    futureRules.current = [];
    onRulesChange(next);
    renderHistory((value) => value + 1);
  };
  const undoRules = () => {
    const previous = pastRules.current.at(-1);
    if (!previous) return;
    pastRules.current = pastRules.current.slice(0, -1);
    futureRules.current = [rules, ...futureRules.current];
    onRulesChange(previous);
    renderHistory((value) => value + 1);
  };
  const redoRules = () => {
    const next = futureRules.current[0];
    if (!next) return;
    futureRules.current = futureRules.current.slice(1);
    pastRules.current = [...pastRules.current, rules];
    onRulesChange(next);
    renderHistory((value) => value + 1);
  };
  const fieldRules = useMemo(() => {
    const visible: { rule: ConditionalFormatRule; index: number }[] = [];
    rules.forEach((rule, index) => { if (rule.fieldId === fieldId) visible.push({ rule, index }); });
    return visible;
  }, [fieldId, rules]);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(() => fieldRules.at(-1)?.index);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection only when the inspected field changes; the effect below reconciles a stale index when the rules list itself changes
  useEffect(() => setActiveIndex(fieldRules.at(-1)?.index), [fieldId]);
  useEffect(() => {
    if (activeIndex !== undefined && !fieldRules.some(({ index }) => index === activeIndex)) setActiveIndex(fieldRules.at(-1)?.index);
  }, [activeIndex, fieldRules]);
  const active = fieldRules.find(({ index }) => index === activeIndex) ?? fieldRules[fieldRules.length - 1] ?? {
    index: rules.length,
    rule: { fieldId, operator: "equals" as const, value: "", format: { foreground: colours[4], background: colours[9] } },
  };
  const updateActive = (next: ConditionalFormatRule) => {
    const updated = [...rules];
    updated[active.index] = next;
    commitRules(updated);
  };
  const updateFormat = (format: ConditionalFormatRule["format"]) => updateActive({ ...active.rule, format: { ...active.rule.format, ...format } });
  const activeField = fields.find((field) => field.id === fieldId);
  const deleteActive = () => {
    if (active.index >= rules.length) return;
    const updated = rules.filter((_, index) => index !== active.index);
    commitRules(updated);
    setActiveIndex(updated.flatMap((rule, index) => rule.fieldId === fieldId ? [index] : []).at(-1));
  };
  const scale = active.rule.colorScale ?? { min: 0, midpoint: 50, max: 100, minColor: colours[7], midpointColor: colours[6], maxColor: colours[1] };
  const setMode = (mode: "highlight" | "scale") => updateActive(mode === "scale"
    ? { ...active.rule, colorScale: scale }
    : { ...active.rule, colorScale: undefined });
  const updateScale = (patch: Partial<typeof scale>) => updateActive({ ...active.rule, colorScale: { ...scale, ...patch } });
  const moveActive = (direction: -1 | 1) => {
    const position = fieldRules.findIndex(({ index }) => index === active.index);
    const other = fieldRules[position + direction];
    if (!other) return;
    const updated = [...rules];
    [updated[active.index], updated[other.index]] = [updated[other.index], updated[active.index]];
    commitRules(updated);
    setActiveIndex(other.index);
  };
  const duplicateActive = () => {
    if (active.index >= rules.length) return;
    const updated = [...rules];
    updated.splice(active.index + 1, 0, { ...active.rule, id: `${active.rule.id ?? "rule"}-${Date.now()}` });
    commitRules(updated);
    setActiveIndex(active.index + 1);
  };
  const validation = active.rule.colorScale && !(scale.min <= scale.midpoint && scale.midpoint <= scale.max)
    ? "Scale values must increase from minimum to maximum."
    : active.rule.applyTo === "range" && !active.rule.range
      ? "Select a range before using Current selection."
      : !active.rule.colorScale && !active.rule.operator.startsWith("is") && String(active.rule.value ?? "").trim() === ""
        ? "Choose or enter a comparison value."
        : undefined;

  return <section ref={setHost} className="conditional-inspector" aria-label="Conditional formatting">
    <header><strong>Conditional formatting</strong><span className="rule-history"><button type="button" aria-label="Undo rule change" disabled={pastRules.current.length === 0} onClick={undoRules}>↶</button><button type="button" aria-label="Redo rule change" disabled={futureRules.current.length === 0} onClick={redoRules}>↷</button></span><button type="button" aria-label="Close conditional formatting" onClick={onClose}>×</button></header>
    <div className="conditional-inspector-body">
      {fields.length > 0
        ? <label>When field<select aria-label="Condition field" value={fieldId} onChange={(event) => onFieldChange?.(event.target.value)}>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label>
        : <label>When field<input aria-label="Condition field" value={fieldId} readOnly /></label>}
      <label>Apply format to<select aria-label="Format target" value={active.rule.applyTo ?? "cell"} onChange={(event) => { const applyTo = event.target.value as "cell" | "column" | "row" | "range"; updateActive({ ...active.rule, applyTo, targetFieldId: applyTo === "column" ? active.rule.targetFieldId ?? fieldId : undefined, range: applyTo === "range" ? selectionRange : undefined }); }}><option value="cell">Cell</option><option value="column">Column</option><option value="row">Row</option><option value="range" disabled={!selectionRange}>Current selection{selectionLabel ? ` · ${selectionLabel}` : ""}</option></select></label>
      {active.rule.applyTo === "column" && <label>Target column<select aria-label="Target column" value={active.rule.targetFieldId ?? fieldId} onChange={(event) => updateActive({ ...active.rule, targetFieldId: event.target.value })}>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label>}
      <fieldset className="conditional-mode" aria-label="Formatting mode">
        <button type="button" className={active.rule.colorScale ? "active" : ""} onClick={() => setMode("scale")}>Color scale</button><button type="button" className={!active.rule.colorScale ? "active" : ""} onClick={() => setMode("highlight")}>Highlight cell</button>
      </fieldset>
      {active.rule.colorScale ? <section>
        <h3>Scale</h3>
        <div className="scale-stops">
          {(["min", "midpoint", "max"] as const).map((stop) => <span key={stop} className="scale-stop"><span>{stop === "midpoint" ? "Mid" : stop[0].toUpperCase() + stop.slice(1)}</span><input aria-label={`${stop} value`} type="number" value={scale[stop]} onChange={(event) => updateScale({ [stop]: Number(event.target.value) })} /><input aria-label={`${stop} colour`} type="color" value={scale[`${stop}Color`]} onChange={(event) => updateScale({ [`${stop}Color`]: event.target.value })} /></span>)}
        </div>
        <div className="scale-preview" style={{ background: `linear-gradient(90deg, ${scale.minColor}, ${scale.midpointColor}, ${scale.maxColor})` }} />
      </section> : <section>
        <h3>Format rules</h3>
        <select aria-label="Condition" value={active.rule.operator} onChange={(event) => updateActive({ ...active.rule, operator: event.target.value as ConditionalFormatOperator })}>
          {Object.entries(operatorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {!active.rule.operator.startsWith("is") && (activeField?.options?.length ? <select aria-label="Comparison value" value={String(active.rule.value ?? "")} onChange={(event) => updateActive({ ...active.rule, value: event.target.value })}><option value="">Select value…</option>{activeField.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : <input aria-label="Comparison value" value={String(active.rule.value ?? "")} onChange={(event) => updateActive({ ...active.rule, value: event.target.value })} />)}
      </section>}
      {!active.rule.colorScale && <section>
        <h3>Formatting style</h3>
        <div className="format-controls">
          <button type="button" className={active.rule.format.fontWeight ? "active" : ""} aria-label="Bold" onClick={() => updateFormat({ fontWeight: active.rule.format.fontWeight ? undefined : 600 })}>B</button>
          <label aria-label="Text colour"><span>A</span><input type="color" value={active.rule.format.foreground ?? colours[4]} onChange={(event) => updateFormat({ foreground: event.target.value })} /></label>
          <label aria-label="Fill colour"><span>▧</span><input type="color" value={active.rule.format.background ?? colours[9]} onChange={(event) => updateFormat({ background: event.target.value })} /></label>
        </div>
        <div className="conditional-preview" style={{ color: active.rule.format.foreground, background: active.rule.format.background, fontWeight: active.rule.format.fontWeight }}>{String(active.rule.value || "Preview")}</div>
      </section>}
      {validation && <p className="rule-validation" role="alert">{validation}</p>}
      <section className="conditional-rules"><h3>Rules</h3>{fieldRules.map(({ rule, index }) => <div className={`conditional-rule${index === active.index ? " active" : ""}${rule.enabled === false ? " disabled" : ""}`} key={rule.id ?? `${rule.operator}-${index}`}><input aria-label={`Enable ${String(rule.value ?? operatorLabels[rule.operator])} rule`} type="checkbox" checked={rule.enabled !== false} onChange={(event) => { const updated = [...rules]; updated[index] = { ...rule, enabled: event.target.checked }; commitRules(updated); }} /><button type="button" onClick={() => setActiveIndex(index)}><span style={{ background: rule.format.background ?? rule.format.foreground }} />{String(rule.value ?? operatorLabels[rule.operator])}<small>{rule.applyTo === "row" ? "row" : rule.applyTo === "column" ? "column" : rule.applyTo === "range" ? "selection" : "cell"}</small></button></div>)}</section>
    </div>
    <footer><button type="button" className="conditional-delete" disabled={active.index >= rules.length} onClick={deleteActive}>Delete</button><button type="button" aria-label="Move rule up" disabled={fieldRules[0]?.index === active.index} onClick={() => moveActive(-1)}>↑</button><button type="button" aria-label="Move rule down" disabled={fieldRules.at(-1)?.index === active.index} onClick={() => moveActive(1)}>↓</button><button type="button" aria-label="Duplicate rule" onClick={duplicateActive}>Duplicate</button><button type="button" className="conditional-add" onClick={() => { const next = [...rules, { id: `rule-${Date.now()}`, fieldId, operator: "equals" as const, value: "", format: { foreground: accentInk, background: colours[7] } }]; commitRules(next); setActiveIndex(next.length - 1); }}>+ Add</button><button type="button" className="conditional-save" disabled={Boolean(validation)} onClick={onClose}>Done</button></footer>
  </section>;
}
