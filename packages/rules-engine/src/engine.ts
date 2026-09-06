import { filterRows, testCondition, toFilterClause, type FilterClause } from "sheetbase-shared";
import type { PipelineRule, Row } from "./types";

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

/** Partition rows into matched / unmatched for a dry run. */
export function dryRun(rules: PipelineRule[], rows: Row[]): Array<{ row: Row; matched: PipelineRule[] }> {
  return rows.map((row) => ({ row, matched: matchRules(rules, row) }));
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
