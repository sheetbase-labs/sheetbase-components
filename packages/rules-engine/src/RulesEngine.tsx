import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  ThemeToggleButton,
  PaneLayout,
  loadInitialState,
  normaliseOperator,
  operatorShortLabel,
  operatorsForField,
  useIdleSave,
  usePersistedTheme,
  type FilterOperator,
  type Layout,
  type PaneSpec,
  type PersistenceAdapter,
  type ThemeMode,
} from "sheetbase-shared";
import type { PipelineRule, Row, RuleActionDef, RuleApplyResult, RuleCondition, RuleOperator, RuleWrite } from "./types";
import { parseNaturalLanguageRule, RuleParseError } from "./language";
import { dryRun, ruleWritesForRows } from "./engine";

export interface RulesEngineHandle {
  /** Append a default rule, as the topbar button does. */
  addRule(): void;
}

export interface RulesEngineProps {
  value?: PipelineRule[];
  initialRules?: PipelineRule[];
  onChange?: (next: PipelineRule[]) => void;
  /** Known pipeline fields for condition editors. */
  fields?: string[];
  /**
   * Optional dataset. When provided the dry-run pane evaluates every rule over
   * these rows (match counts, rejected rows, routes) instead of the JSON probe.
   */
  rows?: readonly Row[];
  /**
   * Maps a dry-run row back to its host record id. Required for the apply
   * affordance — matched rows it can't resolve are counted as skipped.
   */
  recordIdOf?: (row: Row, index: number) => string | undefined;
  /**
   * Commit boundary for transform writes. The component proposes the write
   * set; the host commits it (e.g. `PagedDataAdapter.commit`) and may resolve
   * to accepted/rejected counts for the result line. Applying is destructive:
   * the component confirms before calling this.
   */
  onApplyWrites?: (
    writes: readonly RuleWrite[],
    context: Readonly<{ matched: number; skipped: number; rejected: number }>,
  ) => Promise<RuleApplyResult | void>;
  /** Host-declared action vocabulary. Empty (default) keeps kinds as free text; the component wires no predefined actions. */
  actions?: readonly RuleActionDef[];
  /** Controlled theme. Omit for uncontrolled (toggle manages it). */
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
  persistKey?: string;
  adapter?: PersistenceAdapter<PipelineRule[]>;
  /** Omit the component topbar so a host can own pane chrome. Default `"full"`. */
  chrome?: "full" | "none";
  /** Imperative actions for hosts that render pane chrome. */
  ref?: Ref<RulesEngineHandle>;
}

const OPERATOR_OPTIONS: FilterOperator[] = [...new Set([
  ...operatorsForField({ dataType: "text" }),
  ...operatorsForField({ dataType: "number" }),
  ...operatorsForField({ dataType: "date" }),
  ...operatorsForField({ dataType: "boolean" }),
])];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Rules editor | dry run, each a pane. */
const RULES_PANE_LAYOUT: Layout = {
  kind: "split",
  id: "rules-root",
  direction: "row",
  sizes: [0.68, 0.32],
  children: [
    { kind: "stack", id: "rules-main", panes: ["rules"], active: "rules" },
    { kind: "stack", id: "rules-dry-run", panes: ["dry-run"], active: "dry-run" },
  ],
};

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

export function RulesEngine({ value, initialRules, onChange, fields = [], actions = [], rows, recordIdOf, onApplyWrites, theme, defaultTheme = "light", onThemeChange, persistKey, adapter, chrome = "full", ref }: RulesEngineProps) {
  const [draft, setDraft] = useState<PipelineRule[]>(() => loadInitialState(persistKey, adapter, initialRules ?? []));
  const rules = value ?? draft;
  useIdleSave(persistKey, rules, adapter);
  const { activeTheme, toggleTheme } = usePersistedTheme({ theme, defaultTheme, onThemeChange });
  const [draftText, setDraftText] = useState("");
  const canGenerate = Boolean(draftText.trim());
  const [parseError, setParseError] = useState<string | null>(null);
  const [probe, setProbe] = useState<string>('{"status": "failed", "amount": 1200}');
  const [probeError, setProbeError] = useState<string | null>(null);

  function commit(next: PipelineRule[]) {
    if (value === undefined) setDraft(next);
    onChange?.(next);
  }

  function addFromText() {
    if (!draftText.trim()) return;
    try {
      commit([...rules, parseNaturalLanguageRule(draftText.trim())]);
      setDraftText("");
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof RuleParseError ? error.message : "Could not parse that rule.");
    }
  }

  function addRule() {
    commit([...rules, { id: uid("rule"), name: "New rule", when: "all", conditions: [{ field: fields[0] ?? "status", operator: "eq", value: "" }], actions: [{ kind: actions[0]?.kind ?? "" }], enabled: true, priority: 100 }]);
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

  const dataset = useMemo(() => (rows ? dryRun(rules, [...rows]) : null), [rules, rows]);
  const datasetSummary = useMemo(() => {
    if (!dataset) return null;
    const counts = new Map<string, number>();
    const routes = new Set<string>();
    let rejected = 0;
    for (const entry of dataset) {
      for (const rule of entry.matched) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
      if (entry.effects.rejected) rejected += 1;
      for (const route of entry.effects.routes) routes.add(route);
    }
    return { counts, rejected, routes: [...routes], matched: dataset.filter((entry) => entry.matched.length > 0).length, total: dataset.length };
  }, [dataset]);

  const [applying, setApplying] = useState(false);
  const [applyOutcome, setApplyOutcome] = useState<string | null>(null);
  const applyCapable = Boolean(rows && recordIdOf && onApplyWrites);
  const applyPlan = useMemo(
    () => (rows && recordIdOf && onApplyWrites ? ruleWritesForRows(rules, rows, recordIdOf) : null),
    [rules, rows, recordIdOf, onApplyWrites],
  );

  const applyWrites = useCallback(async (confirm = true) => {
    if (!applyPlan || !onApplyWrites || applying) return;
    if (applyPlan.writes.length === 0) { if (confirm) setApplyOutcome("No transform writes to apply."); return; }
    const writeRows = new Set(applyPlan.writes.map((write) => write.recordId)).size;
    if (confirm && !window.confirm(`Apply ${applyPlan.writes.length} transform writes to ${writeRows} rows?`)) return;
    setApplying(true);
    try {
      const result = await onApplyWrites(applyPlan.writes, { matched: applyPlan.matched, skipped: applyPlan.skipped, rejected: applyPlan.rejected });
      const parts = [`applied ${result?.applied ?? applyPlan.writes.length} writes`];
      if (result?.rejected) parts.push(`${result.rejected} rejected by host`);
      if (applyPlan.rejected) parts.push(`${applyPlan.rejected} rows rejected by rules`);
      if (applyPlan.skipped) parts.push(`${applyPlan.skipped} rows skipped (no record id)`);
      setApplyOutcome(parts.join(" · "));
    } catch (error) {
      setApplyOutcome(error instanceof Error ? error.message : "Apply failed.");
    } finally {
      setApplying(false);
    }
  }, [applyPlan, onApplyWrites, applying]);

  function onProbeChange(text: string) {
    setProbe(text);
    try { JSON.parse(text || "{}"); setProbeError(null); } catch { setProbeError("Invalid JSON — dry run paused."); }
  }

  const active = rules.filter((r) => r.enabled).length;

  // Auto-apply: when enabled, each non-empty write set commits through the
  // host — so a grid edit that brings a row in scope applies immediately,
  // and writes cascade until the rules reach a fixpoint. The circuit
  // breaker stops rules that never converge (each apply produces a fresh
  // write set) instead of looping forever.
  const [autoApply, setAutoApply] = useState(false);
  const autoCircuit = useRef({ count: 0, windowStart: 0, lastKey: "" });
  const applyKey = applyPlan?.writes.length ? JSON.stringify(applyPlan.writes) : "";
  useEffect(() => {
    if (!autoApply || applying) return;
    const circuit = autoCircuit.current;
    // An empty plan re-arms the key guard, so a later edit that recreates a
    // previously-applied write set fires again.
    if (!applyPlan?.writes.length) { circuit.lastKey = ""; return; }
    // The same write set must never refire — if it survives an apply, the
    // host dropped it, and repeating only floods the commit path.
    if (applyKey === circuit.lastKey) return;
    const now = Date.now();
    if (now - circuit.windowStart > 2000) { circuit.count = 0; circuit.windowStart = now; }
    if (++circuit.count > 10) {
      setAutoApply(false);
      setApplyOutcome("Auto-apply stopped — the rules kept producing writes.");
      return;
    }
    circuit.lastKey = applyKey;
    void applyWrites(false);
    // applyPlan/applyWrites identities change whenever the write set does;
    // applyKey additionally dedups unchanged content, and `applying`
    // re-runs the check when the in-flight apply resolves.
  }, [autoApply, applying, applyPlan, applyKey, applyWrites]);

  useImperativeHandle(ref, () => ({ addRule }));

  return (
    <div className="sheetbase-scope sb-rules" data-theme={activeTheme}>
      <div className={chrome === "none" ? "sb-frame no-topbar" : "sb-frame"}>
        {chrome !== "none" && (
          <div className="sb-topbar">
            <div className="sb-toolbar-group">
              <span className="sb-stat">{active} of {rules.length} active</span>
              {applyCapable && (
                <label className="sb-check" title="Commit matching transform writes to the dataset as it changes — a grid edit that puts a row in scope applies immediately">
                  <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} /> auto-apply
                </label>
              )}
            </div>
            <div className="sb-topbar-actions">
              {theme === undefined && <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />}
              <button className="sb-btn primary" onClick={addRule}>+ Rule</button>
            </div>
          </div>
        )}
        <PaneLayout
          className="sb-panes--fit"
          defaultLayout={RULES_PANE_LAYOUT}
          panes={[
            {
              id: "rules",
              title: "Pipeline rules",
              dragHandle: "heading",
              content: (
                <section className="sb-rules-main sb-plate">
            <div className="sb-panel-heading"><span>Pipeline rules</span><span>{rules.length}</span></div>
            <div className="sb-nl">
              <div className="sb-nl-row">
                <input
                  id="sb-nl-input" className="sb-input" placeholder='Describe a rule — e.g. "when status is failed then route to review-queue"'
                  value={draftText} onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addFromText(); }}
                />
                <button
                  type="button"
                  className={canGenerate ? "sb-btn primary sb-nl-action" : "sb-btn primary sb-nl-action is-muted"}
                  aria-disabled={!canGenerate}
                  onClick={() => { if (canGenerate) addFromText(); }}
                >Generate</button>
              </div>
              {parseError && <p className="sb-error">{parseError}</p>}
            </div>
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
                    {rule.actions.map((a, i) => {
                      const def = actions.find((d) => d.kind === a.kind);
                      return (
                      <span className="sb-clause" key={i}>
                        {i > 0 && <span className="sb-join">and</span>}
                        {def ? (
                        <select aria-label="Action" value={a.kind} onChange={(e) => patchRule(rule.id, { actions: rule.actions.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>
                          {actions.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}
                        </select>
                        ) : (
                        <input aria-label="Action" placeholder="action…" value={a.kind} onChange={(e) => patchRule(rule.id, { actions: rule.actions.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })} />
                        )}
                        {def?.needsTarget !== false && (
                          <input aria-label="Action target" placeholder={def?.placeholder ?? "detail…"} value={a.target ?? a.detail ?? ""} onChange={(e) => patchRule(rule.id, { actions: rule.actions.map((x, j) => (j === i ? { ...x, target: e.target.value || undefined } : x)) })} />
                        )}
                        <button className="sb-remove" title="Remove action" onClick={() => patchRule(rule.id, { actions: rule.actions.filter((_, j) => j !== i) })}>×</button>
                      </span>
                      );
                    })}
                    <button className="sb-link-btn" onClick={() => patchRule(rule.id, { actions: [...rule.actions, { kind: actions[0]?.kind ?? "" }] })}>+ action</button>
                    <label className="sb-muted sb-priority">p<input type="number" aria-label="Priority" value={rule.priority} onChange={(e) => patchRule(rule.id, { priority: Number(e.target.value) || 0 })} /></label>
                  </div>
                </li>
              ))}
              {rules.length === 0 && <li className="sb-muted" style={{ padding: 14 }}>No rules yet — describe one above.</li>}
            </ul>
                </section>
              ),
            },
            {
              id: "dry-run",
              title: "Dry run",
              dragHandle: "heading",
              content: (
                <aside className="sb-rules-side sb-plate">
            <div className="sb-panel-heading"><span>Dry run</span></div>
            <div className="sb-rules-editor">
              {datasetSummary ? (
                <>
                  <p className="sb-muted" aria-live="polite" aria-atomic="true">{datasetSummary.total} rows · {datasetSummary.matched} matched</p>
                  {rules.length === 0 ? (
                    <p className="sb-muted">No rules to evaluate.</p>
                  ) : (
                    <ul className="sb-match-list">
                      {rules.map((rule) => (
                        <li key={rule.id}>
                          <strong>{rule.name}</strong>
                          <small>{datasetSummary.counts.get(rule.id) ?? 0} of {datasetSummary.total} rows</small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {datasetSummary.rejected > 0 && <p className="sb-error">{datasetSummary.rejected} rejected</p>}
                  {datasetSummary.routes.length > 0 && <p className="sb-muted">Route {datasetSummary.routes.join(", ")}</p>}
                  {applyPlan && (
                    <>
                      <button type="button" className="sb-btn" disabled={applying} onClick={() => applyWrites()}>
                        {applying ? "Applying…" : `Apply ${applyPlan.writes.length} writes`}
                      </button>
                      {applyOutcome && <p className="sb-muted" role="status">{applyOutcome}</p>}
                    </>
                  )}
                </>
              ) : (
                <>
                  <label>Test row (JSON)<textarea className="sb-probe" value={probe} onChange={(e) => onProbeChange(e.target.value)} rows={5} spellCheck={false} /></label>
                  {probeError ? <p className="sb-error">{probeError}</p> : probeResult && (
                    probeResult.matched.length === 0
                      ? <p className="sb-muted">No rules match this row.</p>
                      : <div>
                        <ul className="sb-match-list">{probeResult.matched.map((m) => <li key={m.id}><strong>{m.name}</strong><small>{m.actions.map((a) => (a.target ? `${a.kind} → ${a.target}` : a.kind)).join(", ")}</small></li>)}</ul>
                        {probeResult.effects.rejected && <p className="sb-error">Rejected</p>}
                        {probeResult.effects.routes.length > 0 && <p className="sb-muted">Route {probeResult.effects.routes.join(", ")}</p>}
                        {Object.keys(probeResult.effects.transforms).length > 0 && (
                          <pre className="sb-probe" style={{ minHeight: 0 }}>{JSON.stringify(probeResult.effects.output, null, 2)}</pre>
                        )}
                      </div>
                  )}
                </>
              )}
            </div>
                </aside>
              ),
            },
          ] satisfies PaneSpec[]}
        />
      </div>
    </div>
  );
}
