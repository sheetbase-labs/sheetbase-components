import type { FilterOperator } from "sheetbase-shared";

/** Canonical operators plus parse-time aliases; evaluateRule normalises. */
export type RuleOperator = FilterOperator | "isEmpty" | "isNotEmpty";

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: string | number | boolean | Array<string | number> | { low: number; high: number };
}

export type RuleActionKind = "flag" | "route" | "transform" | "reject" | "notify";

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
