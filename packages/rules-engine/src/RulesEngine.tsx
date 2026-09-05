import { useMemo, useState } from "react";
import {
  ThemeToggleButton,
  normaliseOperator,
  operatorShortLabel,
  operatorsForField,
  type FilterOperator,
  type ThemeMode,
} from "sheetbase-shared";
import type { PipelineRule, Row, RuleActionKind, RuleCondition, RuleOperator } from "./types";
import { parseNaturalLanguageRule } from "./language";
import { dryRun } from "./engine";

export interface RulesEngineProps {
  value?: PipelineRule[];
  initialRules?: PipelineRule[];
  onChange?: (next: PipelineRule[]) => void;
  /** Known pipeline fields for condition editors. */
  fields?: string[];
  /** Controlled theme. Omit for uncontrolled (toggle manages it). */
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
}

const OPERATOR_OPTIONS: FilterOperator[] = [...new Set([
  ...operatorsForField({ dataType: "text" }),
  ...operatorsForField({ dataType: "number" }),
  ...operatorsForField({ dataType: "date" }),
  ...operatorsForField({ dataType: "boolean" }),
])];

const ACTION_LABELS: Array<{ value: RuleActionKind; label: string }> = [
  { value: "flag", label: "flag" },
  { value: "route", label: "route to" },
  { value: "transform", label: "set" },
  { value: "reject", label: "reject" },
  { value: "notify", label: "notify" },
];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function valueText(value: RuleCondition["value"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

function rangeOf(value: RuleCondition["value"]): { low: number; high: number } {
  if (Array.isArray(value) && value.length >= 2) {
    return { low: Number(value[0]) || 0, high: Number(value[1]) || 0 };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "low" in value && "high" in value) {
    const low = value.low;
    const high = value.high;
    if (typeof low === "number" && typeof high === "number") return { low, high };
  }
  return { low: 0, high: 0 };
}

function isEmptyOp(operator: RuleOperator): boolean {
  const canon = normaliseOperator(operator);
  return canon === "isNull" || canon === "notNull";
}

export function RulesEngine({ value, initialRules, onChange, fields = [], theme, defaultTheme = "light", onThemeChange }: RulesEngineProps) {
  const [draft, setDraft] = useState<PipelineRule[]>(initialRules ?? []);
  const rules = value ?? draft;
  const [innerTheme, setInnerTheme] = useState<ThemeMode>(defaultTheme);
  const activeTheme = theme ?? innerTheme;
  function toggleTheme() {
    const next = activeTheme === "dark" ? "light" : "dark";
    if (theme === undefined) setInnerTheme(next);
    onThemeChange?.(next);
  }
  const [draftText, setDraftText] = useState("");
  const [probe, setProbe] = useState<string>('{"status": "failed", "amount": 1200}');
  const [probeError, setProbeError] = useState<string | null>(null);

  function commit(next: PipelineRule[]) {
    if (value === undefined) setDraft(next);
    onChange?.(next);
  }

  function addFromText() {
    if (!draftText.trim()) return;
    commit([...rules, parseNaturalLanguageRule(draftText.trim())]);
    setDraftText("");
  }

  function patchRule(id: string, patch: Partial<PipelineRule>) {
    commit(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function patchCondition(rule: PipelineRule, index: number, patch: Partial<RuleCondition>) {
    patchRule(rule.id, { conditions: rule.conditions.map((c, j) => (j === index ? { ...c, ...patch } : c)) });
  }

  function removeRule(id: string) {
    commit(rules.filter((r) => r.id !== id));
  }

  const probeResult = useMemo(() => {
    try {
      const row = JSON.parse(probe || "{}") as Row;
      return dryRun(rules, [row])[0] ?? null;
    } catch {
      return null;
    }
  }, [probe, rules]);

  function onProbeChange(text: string) {
    setProbe(text);
    try { JSON.parse(text || "{}"); setProbeError(null); } catch { setProbeError("Invalid JSON — dry run paused."); }
  }

  const active = rules.filter((r) => r.enabled).length;

  return (
    <div className="sheetbase-scope sb-rules" data-theme={activeTheme}>
      <div className="sb-frame">
        <div className="sb-topbar">
          <div className="sb-topbar-actions">
            <span className="sb-stat">{active} of {rules.length} active</span>
            <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
            <button className="sb-btn primary" onClick={() => commit([...rules, { id: uid("rule"), name: "New rule", when: "all", conditions: [{ field: fields[0] ?? "status", operator: "eq", value: "" }], actions: [{ kind: "flag" }], enabled: true, priority: 100 }])}>+ Rule</button>
          </div>
        </div>
        <div className="sb-rules-body sb-plates">
          <section className="sb-rules-main sb-plate">
            <div className="sb-nl">
              <div className="sb-nl-row">
                <input
                  id="sb-nl-input" className="sb-input" placeholder='Describe a rule — e.g. "when status is failed then route to review-queue"'
                  value={draftText} onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addFromText(); }}
                />
                <button className="sb-btn primary" onClick={addFromText} disabled={!draftText.trim()}>Generate</button>
              </div>
            </div>
            <div className="sb-panel-heading"><span>Pipeline rules</span><span>{rules.length}</span></div>
            <ul className="sb-rule-list">
              {rules.map((rule) => (
                <li key={rule.id} className="sb-rule">
                  <div className="sb-rule-head">
                    <span className={rule.enabled ? "sb-dot on" : "sb-dot"} />
                    <input className="sb-name" aria-label="Rule name" value={rule.name} onChange={(e) => patchRule(rule.id, { name: e.target.value })} />
                    <div className="sb-segmented" role="group" aria-label="Match mode">
                      <button className={rule.when === "all" ? "active" : ""} onClick={() => patchRule(rule.id, { when: "all" })}>All</button>
                      <button className={rule.when === "any" ? "active" : ""} onClick={() => patchRule(rule.id, { when: "any" })}>Any</button>
                    </div>
                    <label className="sb-muted sb-check"><input type="checkbox" checked={rule.enabled} onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })} /> on</label>
                    <button className="sb-remove" title="Delete rule" onClick={() => removeRule(rule.id)}>×</button>
                  </div>
                  <div className="sb-sentence">
                    <span className="sb-kw">When</span>
                    {rule.conditions.map((c, i) => {
                      const canon = normaliseOperator(c.operator) ?? "eq";
                      return (
                        <span className="sb-clause" key={i}>
                          {i > 0 && <span className="sb-join">{rule.when === "any" ? "or" : "and"}</span>}
                          {fields.length > 0 ? (
                            <select aria-label="Field" value={c.field} onChange={(e) => patchCondition(rule, i, { field: e.target.value })}>
                              {!fields.includes(c.field) && <option value={c.field}>{c.field || "field…"}</option>}
                              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          ) : (
                            <input aria-label="Field" value={c.field} onChange={(e) => patchCondition(rule, i, { field: e.target.value })} />
                          )}
                          <select
                            aria-label="Operator"
                            value={canon}
                            onChange={(e) => {
                              const next = e.target.value as FilterOperator;
                              patchCondition(rule, i, { operator: next, value: next === "isNull" || next === "notNull" ? undefined : c.value });
                            }}
                          >
                            {OPERATOR_OPTIONS.map((op) => <option key={op} value={op}>{operatorShortLabel(op)}</option>)}
                          </select>
                          {canon === "between" ? (
                            <span className="sb-between">
                              <input aria-label="Low value" placeholder="low" type="number" value={String(rangeOf(c.value).low || "")} onChange={(e) => patchCondition(rule, i, { value: [Number(e.target.value) || 0, rangeOf(c.value).high] })} />
                              <span className="sb-join">and</span>
                              <input aria-label="High value" placeholder="high" type="number" value={String(rangeOf(c.value).high || "")} onChange={(e) => patchCondition(rule, i, { value: [rangeOf(c.value).low, Number(e.target.value) || 0] })} />
                            </span>
                          ) : !isEmptyOp(c.operator) && (
                            <input aria-label="Value" placeholder={canon === "in" ? "a, b, c" : "value"} value={valueText(c.value)} onChange={(e) => patchCondition(rule, i, { value: canon === "in" ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : e.target.value })} />
                          )}
                          <button className="sb-remove" title="Remove condition" onClick={() => patchRule(rule.id, { conditions: rule.conditions.filter((_, j) => j !== i) })}>×</button>
                        </span>
                      );
                    })}
                    <button className="sb-link-btn" onClick={() => patchRule(rule.id, { conditions: [...rule.conditions, { field: fields[0] ?? "status", operator: "eq", value: "" }] })}>+ condition</button>
                  </div>
                  <div className="sb-sentence">
                    <span className="sb-kw">Then</span>
                    {rule.actions.map((a, i) => (
                      <span className="sb-clause" key={i}>
                        {i > 0 && <span className="sb-join">and</span>}
                        <select aria-label="Action" value={a.kind} onChange={(e) => patchRule(rule.id, { actions: rule.actions.map((x, j) => (j === i ? { ...x, kind: e.target.value as RuleActionKind } : x)) })}>
                          {ACTION_LABELS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                        {a.kind !== "reject" && (
                          <input aria-label="Action target" placeholder={a.kind === "route" ? "queue…" : a.kind === "transform" ? "column = value…" : "detail…"} value={a.target ?? a.detail ?? ""} onChange={(e) => patchRule(rule.id, { actions: rule.actions.map((x, j) => (j === i ? { ...x, target: e.target.value || undefined } : x)) })} />
                        )}
                        <button className="sb-remove" title="Remove action" onClick={() => patchRule(rule.id, { actions: rule.actions.filter((_, j) => j !== i) })}>×</button>
                      </span>
                    ))}
                    <button className="sb-link-btn" onClick={() => patchRule(rule.id, { actions: [...rule.actions, { kind: "flag" }] })}>+ action</button>
                    <label className="sb-muted sb-priority">p<input type="number" aria-label="Priority" value={rule.priority} onChange={(e) => patchRule(rule.id, { priority: Number(e.target.value) || 0 })} /></label>
                  </div>
                </li>
              ))}
              {rules.length === 0 && <li className="sb-muted" style={{ padding: 14 }}>No rules yet — describe one above.</li>}
            </ul>
          </section>
          <aside className="sb-rules-side sb-plate">
            <div className="sb-panel-heading"><span>Dry run</span></div>
            <div className="sb-rules-editor">
              <label>Test row (JSON)<textarea className="sb-probe" value={probe} onChange={(e) => onProbeChange(e.target.value)} rows={5} spellCheck={false} /></label>
              {probeError ? <p className="sb-error">{probeError}</p> : probeResult && (
                probeResult.matched.length === 0
                  ? <p className="sb-muted">No rules match this row.</p>
                  : <ul className="sb-match-list">{probeResult.matched.map((m) => <li key={m.id}><strong>{m.name}</strong><small>{m.actions.map((a) => (a.target ? `${a.kind} → ${a.target}` : a.kind)).join(", ")}</small></li>)}</ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
