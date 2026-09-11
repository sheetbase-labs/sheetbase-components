import type { FilterOperator } from "sheetbase-shared";

/** Canonical operators plus parse-time aliases; evaluateRule normalises. */
export type RuleOperator = FilterOperator | "isEmpty" | "isNotEmpty";

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: string | number | boolean | Array<string | number> | { low: number; high: number };
}

/** Open action vocabulary: hosts declare the kinds their pipeline understands. */
export type RuleActionKind = string;

export interface RuleActionDef {
  kind: string;
  label: string;
  placeholder?: string;
  /** False hides the target input (e.g. reject needs no target). Default true. */
  needsTarget?: boolean;
}

/** Demo vocabulary (mirrors the engine's built-in semantics); the component itself wires none. */
export const sampleRuleActions: RuleActionDef[] = [
  { kind: "flag", label: "flag", placeholder: "detail…" },
  { kind: "route", label: "route to", placeholder: "queue…" },
  { kind: "transform", label: "transform", placeholder: "column = value…" },
  { kind: "reject", label: "reject", needsTarget: false },
  { kind: "notify", label: "notify", placeholder: "detail…" },
];

export interface RuleAction {
  kind: RuleActionKind;
  /** Pipeline stage / queue / column target, depending on kind. */
  target?: string;
  /** Human note or transform expression. */
  detail?: string;
}

export interface PipelineRule {
  id: string;
  name: string;
  description?: string;
  /** How multiple conditions combine. */
  when: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  /** Lower runs first. */
  priority: number;
}

export type Row = Record<string, unknown>;

/**
 * A field write proposed by a transform action. Structurally identical to the
 * table's `RecordFieldWrite` minus `datasetId`, which the host supplies when it
 * commits (rules-engine must not depend on sheetbase-table).
 */
export type RuleWrite = Readonly<{
  recordId: string;
  fieldId: string;
  before?: string;
  after?: string;
}>;

/** What an apply pass would do, before any host commit. */
export type RuleApplyPlan = Readonly<{
  /** One write per matched row per transformed field (final value, last-wins). */
  writes: readonly RuleWrite[];
  /** Rows that matched at least one enabled rule. */
  matched: number;
  /** Matched rows skipped because `recordIdOf` could not resolve them. */
  skipped: number;
  /** Matched rows a `reject` action excluded from writing. */
  rejected: number;
}>;

/** Host-reported outcome of committing a plan's writes. */
export type RuleApplyResult = Readonly<{
  /** Writes the host accepted. Defaults to all proposed writes when omitted. */
  applied?: number;
  /** Writes the host rejected (e.g. revision conflicts). */
  rejected?: number;
}>;
