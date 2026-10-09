import { filterRows, testCondition, toFilterClause, type FilterClause } from "@sheetbase-labs/sheetbase-shared";
import type { PipelineRule, Row, RuleAction, RuleApplyPlan, RuleWrite } from "./types";

/** Does a row satisfy a rule (disabled rules never match)?
 * Match behaviour: `when: "all"` is AND, `when: "any"` is OR. */
export function evaluateRule(rule: PipelineRule, row: Row): boolean {
  if (!rule.enabled || !rule.conditions.length) return false;
  const results = rule.conditions.map((c) => {
    const clause = toFilterClause({ field: c.field, operator: c.operator, value: c.value });
    return clause ? testCondition(row, clause) : false;
  });
  return rule.when === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** All enabled rules matching a row, ordered by priority then name. */
export function matchRules(rules: PipelineRule[], row: Row): PipelineRule[] {
  return rules
    .filter((r) => evaluateRule(r, row))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export type RuleEffects = Readonly<{
  rejected: boolean;
  flags: readonly string[];
  routes: readonly string[];
  notifications: readonly string[];
  transforms: Readonly<Record<string, unknown>>;
  output: Row;
}>;

function coerceTransformValue(raw: string): unknown {
  const clean = raw.replace(/^["']|["']$/g, "").trim();
  if (/^(true|yes)$/i.test(clean)) return true;
  if (/^(false|no)$/i.test(clean)) return false;
  const n = Number(clean.replace(/,/g, ""));
  return Number.isFinite(n) && clean !== "" ? n : clean;
}

/** Resolve a transform action into a field write. */
export function transformWrite(action: RuleAction): { field: string; value: unknown } | undefined {
  if (action.kind !== "transform") return undefined;
  if (action.target && action.detail) return { field: action.target, value: coerceTransformValue(action.detail) };
  const raw = action.target ?? action.detail ?? "";
  const match = raw.match(/^([\w.]+)\s*(?:=|to)\s*(.+)$/i) ?? raw.match(/^([\w.]+)\s+(.+)$/);
  if (!match) return undefined;
  const [, field, value] = match;
  if (!field || !value) return undefined;
  return { field, value: coerceTransformValue(value) };
}

/** Apply matched-rule actions in priority order. Later transforms overwrite earlier ones. */
export function applyActions(row: Row, rules: PipelineRule[]): RuleEffects {
  const matched = matchRules(rules, row);
  let output: Row = { ...row };
  let rejected = false;
  const flags: string[] = [];
  const routes: string[] = [];
  const notifications: string[] = [];
  const transforms: Record<string, unknown> = {};
  for (const rule of matched) {
    for (const action of rule.actions) {
      if (action.kind === "reject") rejected = true;
      if (action.kind === "flag") flags.push(action.detail ?? rule.name);
      if (action.kind === "route" && action.target) routes.push(action.target);
      if (action.kind === "notify") notifications.push(action.detail ?? action.target ?? rule.name);
      if (action.kind === "transform") {
        const write = transformWrite(action);
        if (write) {
          transforms[write.field] = write.value;
          output = { ...output, [write.field]: write.value };
        }
      }
    }
  }
  return { rejected, flags, routes, notifications, transforms, output };
}

/** Partition rows into matched / unmatched for a dry run, including applied effects. */
export function dryRun(rules: PipelineRule[], rows: Row[]): Array<{ row: Row; matched: PipelineRule[]; effects: RuleEffects }> {
  return rows.map((row) => ({ row, matched: matchRules(rules, row), effects: applyActions(row, rules) }));
}

/**
 * Build the write set an apply pass would commit. Only `transform` actions
 * produce writes — flag/route/notify are host-semantic and only reported via
 * the plan counts; `reject` excludes the row from writing entirely. When
 * several matched rules transform the same field, the last write wins, so the
 * emitted write carries the final value.
 */
export function ruleWritesForRows(
  rules: PipelineRule[],
  rows: readonly Row[],
  recordIdOf: (row: Row, index: number) => string | undefined,
): RuleApplyPlan {
  const writes: RuleWrite[] = [];
  let matched = 0;
  let skipped = 0;
  let rejected = 0;
  rows.forEach((row, index) => {
    const matchedRules = matchRules(rules, row);
    if (matchedRules.length === 0) return;
    matched += 1;
    const effects = applyActions(row, matchedRules);
    if (effects.rejected) { rejected += 1; return; }
    const fields = Object.keys(effects.transforms);
    if (fields.length === 0) return;
    const recordId = recordIdOf(row, index);
    if (!recordId) { skipped += 1; return; }
    for (const field of fields) {
      // Skip writes that would restate the current value — the write set is
      // what a pass still needs to change, so applied rules converge to an
      // empty set instead of rewriting the same cells forever.
      if (row[field] !== undefined && String(row[field]) === String(effects.transforms[field])) continue;
      writes.push({
        recordId,
        fieldId: field,
        before: row[field] === undefined ? undefined : String(row[field]),
        after: String(effects.transforms[field]),
      });
    }
  });
  return { writes, matched, skipped, rejected };
}

/**
 * Dry-run a single rule against a dataset via shared filterRows.
 * Aliases such as isEmpty are normalised inside toFilterClause.
 */
export function dryRunRule(rule: PipelineRule, rows: readonly Row[]): Row[] {
  if (!rule.enabled || !rule.conditions.length) return [];
  const clauses: FilterClause[] = [];
  for (const c of rule.conditions) {
    const clause = toFilterClause({ field: c.field, operator: c.operator, value: c.value });
    if (!clause) return [];
    clauses.push(clause);
  }
  return filterRows(rows, clauses, rule.when === "any" ? "or" : "and");
}
