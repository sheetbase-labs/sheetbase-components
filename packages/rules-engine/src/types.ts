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
