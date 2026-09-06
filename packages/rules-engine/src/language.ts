import type { PipelineRule, RuleAction, RuleCondition, RuleOperator } from "./types";

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function asNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Split "a and b" / "a or b" condition clauses, remembering the combinator. */
function splitClauses(text: string): { clauses: string[]; when: "all" | "any" } {
  const orParts = text.split(/\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
  if (orParts.length > 1) return { clauses: orParts, when: "any" };
  return { clauses: text.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean), when: "all" };
}

const COMPARISONS: Array<{ re: RegExp; operator: RuleOperator; value: (m: RegExpMatchArray) => RuleCondition["value"] }> = [
  { re: /^(.+?)\s+is\s+greater\s+than\s+or\s+equal\s+to\s+(.+)$/i, operator: "gte", value: (m) => asNumber(m[2]!.trim()) ?? m[2]!.trim() },
  { re: /^(.+?)\s+is\s+less\s+than\s+or\s+equal\s+to\s+(.+)$/i, operator: "lte", value: (m) => asNumber(m[2]!.trim()) ?? m[2]!.trim() },
  { re: /^(.+?)\s+is\s+(greater|more|higher|above)\s+than\s+(.+)$/i, operator: "gt", value: (m) => asNumber(m[3]!.trim()) ?? m[3]!.trim() },
  { re: /^(.+?)\s+is\s+(less|lower|below|under)\s+than\s+(.+)$/i, operator: "lt", value: (m) => asNumber(m[3]!.trim()) ?? m[3]!.trim() },
  { re: /^(.+?)\s+is\s+between\s+(.+?)\s+and\s+(.+)$/i, operator: "between", value: (m) => ({ low: asNumber(m[2]!.trim()) ?? 0, high: asNumber(m[3]!.trim()) ?? 0 }) },
  { re: /^(.+?)\s+is\s+(empty|blank|missing)$/i, operator: "isEmpty", value: () => undefined },
  { re: /^(.+?)\s+is\s+not\s+empty$/i, operator: "isNotEmpty", value: () => undefined },
  { re: /^(.+?)\s+(contains?)\s+(.+)$/i, operator: "contains", value: (m) => m[3]!.trim().replace(/^["']|["']$/g, "") },
  { re: /^(.+?)\s+(starts\s+with)\s+(.+)$/i, operator: "startsWith", value: (m) => m[3]!.trim().replace(/^["']|["']$/g, "") },
  { re: /^(.+?)\s+(ends\s+with)\s+(.+)$/i, operator: "endsWith", value: (m) => { const n = asNumber(m[3]!.trim()); return n !== null ? n : m[3]!.trim().replace(/^["']|["']$/g, ""); } },
  { re: /^(.+?)\s+is\s+not\s+(.+)$/i, operator: "neq", value: (m) => coerceValue(m[2]!.trim()) },
  { re: /^(.+?)\s+(?:is|equals?|=)\s+(.+)$/i, operator: "eq", value: (m) => coerceValue(m[2]!.trim()) },
];

function coerceValue(raw: string): string | number | boolean {
  const clean = raw.replace(/^["']|["']$/g, "").trim();
  if (/^(true|yes)$/i.test(clean)) return true;
  if (/^(false|no)$/i.test(clean)) return false;
  const n = asNumber(clean);
  return n !== null && clean !== "" ? n : clean;
}

function parseClause(clause: string, fieldHint?: string): RuleCondition | null {
  const text = clause.trim().replace(/^(where|if|when)\s+/i, "");
  for (const c of COMPARISONS) {
    const m = text.match(c.re);
    if (m) return { field: normaliseField(m[1]!.trim(), fieldHint), operator: c.operator, value: c.value(m) };
  }
  return null;
}

/** Normalise a spoken field name onto a row key. */
function normaliseField(raw: string, hint?: string): string {
  const clean = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "_").toLowerCase();
  if (!clean || clean === "it" || clean === "row" || clean === "value") return hint ?? "value";
  return clean;
}

function parseActions(text: string): RuleAction[] {
  const t = text.trim();
  if (!t) return [{ kind: "flag", detail: "Review" }];
  const out: RuleAction[] = [];
  const push = (a: RuleAction) => { if (!out.some((x) => x.kind === a.kind && x.target === a.target)) out.push(a); };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/rout\w*\s+(?:it\s+|them\s+|rows?\s+)?to\s+["']?([\w\-/ ]+)["']?/i))) push({ kind: "route", target: m[1]!.trim() });
  if ((m = t.match(/send\s+(?:it\s+|them\s+)?to\s+["']?([\w\-/ ]+)["']?/i))) push({ kind: "route", target: m[1]!.trim() });
  if (/reject|drop|quarantine|block/i.test(t)) push({ kind: "reject", detail: t });
  if (/flag|escalate|alert|review(?!-)/i.test(t)) push({ kind: "flag", detail: t });
  if ((m = t.match(/set\s+([\w.]+)\s+to\s+(.+)$/i))) push({ kind: "transform", target: m[1]!.trim(), detail: m[2]!.trim() });
  if (/notif|email|slack|webhook/i.test(t)) push({ kind: "notify", detail: t });
  if (out.length === 0) push({ kind: "flag", detail: t });
  return out;
}

/**
 * Turn human language into a pipeline rule.
 * Understands: "when <conds> then <actions>", "if <conds>, <actions>",
 * "require <field> ...", "reject rows where <conds>".
 */
export function parseNaturalLanguageRule(input: string, idPrefix = "rule"): PipelineRule {
  const text = input.trim();
  const thenSplit = text.split(/\s+then\s+/i);
  const commaSplit = thenSplit.length > 1 ? thenSplit : text.split(/,\s*(?=(?:rout|send|set|flag|reject|notif|email|alert|drop|quarantine|block)\b)/i);

  let condText = "";
  let actionText = "";
  if (commaSplit.length > 1) {
    condText = commaSplit[0]!.trim();
    actionText = commaSplit.slice(1).join(", ").trim();
  } else {
    condText = text;
  }

  // "reject rows where X" — condition-first with reject action.
  const rejectMatch = condText.match(/^(reject|drop|quarantine|block)\s+(?:rows?\s+)?(?:where\s+)?(.+)$/i);
  if (rejectMatch) {
    condText = rejectMatch[2]!.trim();
    actionText = `${rejectMatch[1]} ${actionText}`.trim();
  }
  // "require X to be ..." implies reject when violated — keep as flag + eq semantics.
  condText = condText.replace(/^(if|when|where|for\s+rows?\s+where|rows?\s+where)\s+/i, "").replace(/^require\s+/i, "");

  const { clauses, when } = splitClauses(condText);
  const conditions: RuleCondition[] = [];
  for (const clause of clauses) {
    const parsed = parseClause(clause, conditions[0]?.field);
    if (parsed) conditions.push(parsed);
  }
  if (conditions.length === 0) {
    conditions.push({ field: "value", operator: "contains", value: condText.slice(0, 80) || "review" });
  }

  const actions = parseActions(actionText || (rejectMatch ? rejectMatch[1]! : "flag for review"));
  const name = text.length > 64 ? `${text.slice(0, 61)}…` : text || "Untitled rule";
  return { id: uid(idPrefix), name, description: `Parsed from: "${text}"`, when, conditions, actions, enabled: true, priority: 100 };
}

/** Render a rule back as a sentence — round-trip preview in the UI. */
export function describeRule(rule: PipelineRule): string {
  const conds = rule.conditions.map((c) => {
    const v = typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value ?? "");
    return `${c.field} ${c.operator} ${v}`.trim();
  });
  const joiner = rule.when === "any" ? " OR " : " AND ";
  const acts = rule.actions.map((a) => (a.target ? `${a.kind} → ${a.target}` : a.kind)).join(", ");
  return `WHEN ${conds.join(joiner) || "—"} THEN ${acts || "—"}`;
}
