import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** A compact work surface that can grow to hold table-adjacent tools and charts. */
export function TableSurface({ table, companion, companionWidth = 292, className = "", action, theme = "light", objects = [], frame = true }: TableSurfaceProps) {
  if (!frame) return <>{table}</>;
  const resolvedObjects = objects.length > 0 ? objects : companion ? [{ id: "companion", placement: "right" as const, size: companionWidth, content: companion }] : [];
  const rightObject = resolvedObjects.find((object) => object.placement === "right");
  const bottomObject = resolvedObjects.find((object) => object.placement === "bottom");
  const resizeWithKeys = (object: TableSurfaceObject) => (event: React.KeyboardEvent) => {
    const grow = object.placement === "right" ? event.key === "ArrowLeft" : event.key === "ArrowDown";
    const shrink = object.placement === "right" ? event.key === "ArrowRight" : event.key === "ArrowUp";
    if (!grow && !shrink) return;
    event.preventDefault();
    object.onResize?.(Math.max(220, Math.min(520, object.size + (grow ? 16 : -16))));
  };
  const startResize = (event: React.PointerEvent, object: TableSurfaceObject) => {
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
  };
  return <section
    className={`table-surface${rightObject ? " with-companion with-right-object" : ""}${bottomObject ? " with-bottom-object" : ""}${className ? ` ${className}` : ""}`}
    style={{ "--table-companion-width": `${rightObject?.size ?? companionWidth}px`, "--table-bottom-height": `${bottomObject?.size ?? 240}px` } as CSSProperties}
    data-theme={theme}
  >
    <div className="table-surface-table">{table}</div>
    {resolvedObjects.length === 0 && action && <div className="table-surface-action">{action}</div>}
    {rightObject && <aside className="table-surface-companion table-surface-object" data-object-id={rightObject.id}><div className="surface-resizer horizontal" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0} onPointerDown={(event) => startResize(event, rightObject)} onKeyDown={resizeWithKeys(rightObject)} />{rightObject.content}</aside>}
    {bottomObject && <aside className="table-surface-bottom table-surface-object" data-object-id={bottomObject.id}><div className="surface-resizer vertical" role="separator" aria-orientation="horizontal" aria-label="Resize panel" tabIndex={0} onPointerDown={(event) => startResize(event, bottomObject)} onKeyDown={resizeWithKeys(bottomObject)} />{bottomObject.content}</aside>}
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
const builtInLightColours = ["#242424", "#7652ef", "#167a59", "#3e67af", "#a23131", "#8a5a00", "#ffffff", "#f2efff", "#e8f6ef", "#fff1f1"];
const builtInDarkColours = ["#e7e5ec", "#a997ff", "#68d5ae", "#82aaff", "#ff8f8f", "#f0bd63", "#17161a", "#302a43", "#18382e", "#442526"];

function ColourPalette({ label, value, colours, theme, onChange }: Readonly<{ label: string; value?: string; colours: readonly string[]; theme: "light" | "dark"; onChange(value: string): void }>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const popover = usePortalPopover(open, () => setOpen(false), { popover: paletteRef, trigger: buttonRef });
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
  const onSwatchKeys = (event: React.KeyboardEvent) => {
    const swatches = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
    const columns = 5;
    const current = swatches.indexOf(document.activeElement as HTMLElement);
    if (current < 0 || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offsets: Record<string, number> = { ArrowDown: columns, ArrowUp: -columns, ArrowLeft: -1, ArrowRight: 1 };
    const next = Math.max(0, Math.min(swatches.length - 1, current + (offsets[event.key] ?? 0)));
    swatches[next]!.focus();
  };
  const palette = <div
    ref={paletteRef}
    className="format-swatches"
    role="dialog"
    aria-label={`${label} palette`}
    data-theme={theme}
    style={position}
    onKeyDown={(event) => { popover.onKeyDown(event); onSwatchKeys(event); }}
    onBlur={(event) => popover.onBlurOut(event)}
  >{colours.map((colour) => <button aria-label={`${label} ${colour}`} key={colour} style={{ background: colour }} onClick={() => { onChange(colour); setOpen(false); buttonRef.current?.focus(); }} />)}</div>;
  return <div className="format-palette"><button ref={buttonRef} className={open ? "active" : ""} aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}><span>{label === "Text colour" ? "A" : "▧"}</span><i style={value ? { background: value } : undefined} /></button>{open && typeof document !== "undefined" && createPortal(palette, document.body)}</div>;
}

export function TableFormattingToolbar({ selection, onFormat, format = {}, mixedFormats = [], theme = "light", themeMode = theme, onThemeChange, viewControls, colours, darkColours, defaultTextColour = "#242424", defaultFillColour = "#ffffff" }: TableFormattingToolbarProps) {
  const [recentColours, setRecentColours] = useState<readonly string[]>([]);
  const configuredColours = theme === "dark" ? darkColours ?? colours ?? builtInDarkColours : colours ?? builtInLightColours;
  const paletteColours = [...recentColours, ...configuredColours].filter((colour, index, all) => all.indexOf(colour) === index);
  const applyColour = (property: "foreground" | "background", colour: string) => {
    setRecentColours((current) => [colour, ...current.filter((item) => item !== colour)].slice(0, 5));
    onFormat({ [property]: colour });
  };
  const mixed = (property: keyof CellFormat) => mixedFormats.includes(property);
  return <div className="table-formatting-toolbar" role="toolbar" aria-label="Format selection">
    <span className="format-selection" title={selection}>{selection}</span>
    <span className="format-divider" />
    <button className={`${format.fontWeight && format.fontWeight >= 600 && !mixed("fontWeight") ? "active" : ""}${mixed("fontWeight") ? " mixed" : ""}`} aria-label="Bold" title="Bold" onClick={() => onFormat({ fontWeight: format.fontWeight && format.fontWeight >= 600 && !mixed("fontWeight") ? 400 : 600 })}>B</button>
    <ColourPalette label="Text colour" value={mixed("foreground") ? undefined : format.foreground ?? defaultTextColour} colours={paletteColours} theme={theme} onChange={(colour) => applyColour("foreground", colour)} />
    <ColourPalette label="Fill colour" value={mixed("background") ? undefined : format.background ?? defaultFillColour} colours={paletteColours} theme={theme} onChange={(colour) => applyColour("background", colour)} />
    <span className="format-divider" />
    <button className={format.horizontalAlign === "left" && !mixed("horizontalAlign") ? "active" : ""} aria-label="Align left" title="Align left" onClick={() => onFormat({ horizontalAlign: "left" })}>≡</button>
    <button className={format.horizontalAlign === "center" && !mixed("horizontalAlign") ? "active" : ""} aria-label="Align centre" title="Align centre" onClick={() => onFormat({ horizontalAlign: "center" })}>≣</button>
    <button aria-label="Align right" title="Align right" className={`align-right${format.horizontalAlign === "right" && !mixed("horizontalAlign") ? " active" : ""}`} onClick={() => onFormat({ horizontalAlign: "right" })}>≡</button>
    <select aria-label="Number format" value={mixed("numberFormat") ? "mixed" : format.numberFormat ?? "general"} onChange={(event) => onFormat({ numberFormat: event.target.value as CellFormat["numberFormat"] })}>
      <option value="mixed" disabled>Mixed</option><option value="general">General</option><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percent</option><option value="date">Date</option>
    </select>
    <span className="format-divider" />
    <button className="clear-format" onClick={() => onFormat({ foreground: undefined, background: undefined, fontWeight: undefined, horizontalAlign: undefined, numberFormat: "general" })}>Clear</button>
    {(viewControls || onThemeChange) && <span className="format-spacer" />}{viewControls}
    {onThemeChange && <button className="theme-toggle" aria-label={`Use ${themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light"} mode`} title={`Theme: ${themeMode}`} onClick={() => onThemeChange(themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light")}>{themeMode === "dark" ? "◑" : themeMode === "system" ? "☀" : "◐"}</button>}
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
  const fieldRules = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.fieldId === fieldId);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(() => fieldRules.at(-1)?.index);
  useEffect(() => setActiveIndex(fieldRules.at(-1)?.index), [fieldId]);
  useEffect(() => {
    if (activeIndex !== undefined && !fieldRules.some(({ index }) => index === activeIndex)) setActiveIndex(fieldRules.at(-1)?.index);
  }, [activeIndex, fieldRules]);
  const active = fieldRules.find(({ index }) => index === activeIndex) ?? fieldRules[fieldRules.length - 1] ?? {
    index: rules.length,
    rule: { fieldId, operator: "equals" as const, value: "", format: { foreground: "#a23131", background: "#fff1f1" } },
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
    setActiveIndex(updated.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.fieldId === fieldId).at(-1)?.index);
  };
  const scale = active.rule.colorScale ?? { min: 0, midpoint: 50, max: 100, minColor: "#f2efff", midpointColor: "#ffffff", maxColor: "#7652ef" };
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

  return <div className="conditional-inspector" aria-label="Conditional formatting">
    <header><strong>Conditional formatting</strong><span className="rule-history"><button aria-label="Undo rule change" disabled={pastRules.current.length === 0} onClick={undoRules}>↶</button><button aria-label="Redo rule change" disabled={futureRules.current.length === 0} onClick={redoRules}>↷</button></span><button aria-label="Close conditional formatting" onClick={onClose}>×</button></header>
    <div className="conditional-inspector-body">
      <label>When field{fields.length > 0 ? <select aria-label="Condition field" value={fieldId} onChange={(event) => onFieldChange?.(event.target.value)}>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select> : <input value={fieldId} readOnly />}</label>
      <label>Apply format to<select aria-label="Format target" value={active.rule.applyTo ?? "cell"} onChange={(event) => { const applyTo = event.target.value as "cell" | "column" | "row" | "range"; updateActive({ ...active.rule, applyTo, targetFieldId: applyTo === "column" ? active.rule.targetFieldId ?? fieldId : undefined, range: applyTo === "range" ? selectionRange : undefined }); }}><option value="cell">Cell</option><option value="column">Column</option><option value="row">Row</option><option value="range" disabled={!selectionRange}>Current selection{selectionLabel ? ` · ${selectionLabel}` : ""}</option></select></label>
      {active.rule.applyTo === "column" && <label>Target column<select aria-label="Target column" value={active.rule.targetFieldId ?? fieldId} onChange={(event) => updateActive({ ...active.rule, targetFieldId: event.target.value })}>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label>}
      <div className="conditional-mode" role="group" aria-label="Formatting mode">
        <button className={active.rule.colorScale ? "active" : ""} onClick={() => setMode("scale")}>Color scale</button><button className={!active.rule.colorScale ? "active" : ""} onClick={() => setMode("highlight")}>Highlight cell</button>
      </div>
      {active.rule.colorScale ? <section>
        <h3>Scale</h3>
        <div className="scale-stops">
          {(["min", "midpoint", "max"] as const).map((stop) => <label key={stop}><span>{stop === "midpoint" ? "Mid" : stop[0].toUpperCase() + stop.slice(1)}</span><input type="number" value={scale[stop]} onChange={(event) => updateScale({ [stop]: Number(event.target.value) })} /><input aria-label={`${stop} colour`} type="color" value={scale[`${stop}Color`]} onChange={(event) => updateScale({ [`${stop}Color`]: event.target.value })} /></label>)}
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
          <button className={active.rule.format.fontWeight ? "active" : ""} aria-label="Bold" onClick={() => updateFormat({ fontWeight: active.rule.format.fontWeight ? undefined : 600 })}>B</button>
          <label aria-label="Text colour"><span>A</span><input type="color" value={active.rule.format.foreground ?? "#a23131"} onChange={(event) => updateFormat({ foreground: event.target.value })} /></label>
          <label aria-label="Fill colour"><span>▧</span><input type="color" value={active.rule.format.background ?? "#fff1f1"} onChange={(event) => updateFormat({ background: event.target.value })} /></label>
        </div>
        <div className="conditional-preview" style={{ color: active.rule.format.foreground, background: active.rule.format.background, fontWeight: active.rule.format.fontWeight }}>{String(active.rule.value || "Preview")}</div>
      </section>}
      {validation && <p className="rule-validation" role="alert">{validation}</p>}
      <section className="conditional-rules"><h3>Rules</h3>{fieldRules.map(({ rule, index }) => <div className={`conditional-rule${index === active.index ? " active" : ""}${rule.enabled === false ? " disabled" : ""}`} key={rule.id ?? `${rule.operator}-${index}`}><input aria-label={`Enable ${String(rule.value ?? operatorLabels[rule.operator])} rule`} type="checkbox" checked={rule.enabled !== false} onChange={(event) => { const updated = [...rules]; updated[index] = { ...rule, enabled: event.target.checked }; commitRules(updated); }} /><button onClick={() => setActiveIndex(index)}><span style={{ background: rule.format.background ?? rule.format.foreground }} />{String(rule.value ?? operatorLabels[rule.operator])}<small>{rule.applyTo === "row" ? "row" : rule.applyTo === "column" ? "column" : rule.applyTo === "range" ? "selection" : "cell"}</small></button></div>)}</section>
    </div>
    <footer><button className="conditional-delete" disabled={active.index >= rules.length} onClick={deleteActive}>Delete</button><button aria-label="Move rule up" disabled={fieldRules[0]?.index === active.index} onClick={() => moveActive(-1)}>↑</button><button aria-label="Move rule down" disabled={fieldRules.at(-1)?.index === active.index} onClick={() => moveActive(1)}>↓</button><button aria-label="Duplicate rule" onClick={duplicateActive}>Duplicate</button><button className="conditional-add" onClick={() => { const next = [...rules, { id: `rule-${Date.now()}`, fieldId, operator: "equals" as const, value: "", format: { foreground: "#35277f", background: "#f2efff" } }]; commitRules(next); setActiveIndex(next.length - 1); }}>+ Add</button><button className="conditional-save" disabled={Boolean(validation)} onClick={onClose}>Done</button></footer>
  </div>;
}
