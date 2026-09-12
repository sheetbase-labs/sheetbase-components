import type { FilterClause, DatasetQuery, SortClause, SortDirection } from "./query";
import type { FilterOperator } from "./operators";
import { filterRows, matchClauses, testCondition, type Row } from "./predicate";

export type Combinator = "AND" | "OR" | "NOT";

export type ConditionNode = Readonly<{
  type: "condition";
  id: string;
  field: string;
  operator: FilterOperator;
  value?: unknown;
}>;

export type GroupNode = Readonly<{
  type: "group";
  id: string;
  combinator: Combinator;
  children: readonly FilterNode[];
}>;

export type FilterNode = ConditionNode | GroupNode;

export type SearchSpec = Readonly<{
  filter: GroupNode;
  groupBy?: string;
  sort?: { field: string; direction: SortDirection };
  limit?: number;
}>;

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyGroup(combinator: Combinator = "AND"): GroupNode {
  return { type: "group", id: uid("grp"), combinator, children: [] };
}

export function emptyCondition(field = ""): ConditionNode {
  return { type: "condition", id: uid("cnd"), field, operator: "contains", value: "" };
}

export function emptyRoot(): GroupNode {
  return emptyGroup("AND");
}

/**
 * AND `condition` into a root group: appends to an AND root, or wraps a
 * non-AND root so the existing tree stays intact under one AND. Never
 * mutates; existing nodes keep their ids.
 */
export function andCondition(root: GroupNode, condition: ConditionNode): GroupNode {
  if (root.combinator === "AND") return { ...root, children: [...root.children, condition] };
  return { ...emptyRoot(), children: [root, condition] };
}

/**
 * Remove root-level conditions matching field + operator + serialised value
 * (structural equality). Cross-filter conditions are always added at root
 * level, so deeper nodes are left alone. Returns `root` unchanged when
 * nothing matched — referential compare doubles as a containment check.
 */
export function withoutCondition(
  root: GroupNode,
  match: { field: string; operator: FilterOperator; value: unknown },
): GroupNode {
  const serialised = JSON.stringify(match.value);
  const children = root.children.filter(
    (child) =>
      child.type !== "condition" ||
      child.field !== match.field ||
      child.operator !== match.operator ||
      JSON.stringify(child.value) !== serialised,
  );
  return children.length === root.children.length ? root : { ...root, children };
}

function conditionClause(node: ConditionNode): FilterClause {
  return { fieldId: node.field, operator: node.operator, value: node.value };
}

/** Compile a filter tree to a row predicate. NOT matches when none of its children match. */
export function buildPredicate(node: FilterNode): (row: Row) => boolean {
  if (node.type === "condition") return (row) => testCondition(row, conditionClause(node));
  const compiled = node.children.map(buildPredicate);
  if (node.combinator === "OR") return (row) => compiled.some((fn) => fn(row));
  if (node.combinator === "NOT") return (row) => !compiled.some((fn) => fn(row));
  return (row) => compiled.every((fn) => fn(row));
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function cell(row: Row, field: string): unknown {
  if (field in row) return row[field];
  const lower = field.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) return row[key];
  }
  return undefined;
}

/** Apply a full search spec: filter, then sort, then limit. `groupBy` is left to the caller. */
export function applySearch<T extends Row>(rows: readonly T[], spec: SearchSpec): T[] {
  const predicate = buildPredicate(spec.filter);
  let out = rows.filter(predicate);
  if (spec.sort) {
    const { field, direction } = spec.sort;
    const sign = direction === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const an = num(cell(a, field));
      const bn = num(cell(b, field));
      if (an !== null && bn !== null) return (an - bn) * sign;
      return text(cell(a, field)).localeCompare(text(cell(b, field))) * sign;
    });
  }
  return typeof spec.limit === "number" ? out.slice(0, Math.max(0, spec.limit)) : out;
}

export function groupRows<T extends Row>(
  rows: readonly T[],
  groupBy: string,
): Array<{ key: string; count: number; rows: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = text(cell(row, groupBy)) || "(blank)";
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({ key, count: list.length, rows: list }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function describeFilter(node: FilterNode): string {
  if (node.type === "condition") {
    const v = typeof node.value === "object" ? JSON.stringify(node.value) : JSON.stringify(node.value ?? "");
    return `${node.field || "?"} ${node.operator} ${v}`;
  }
  return `${node.combinator}(${node.children.map(describeFilter).join(", ") || "…"})`;
}

export function countNodes(node: FilterNode): { groups: number; conditions: number } {
  if (node.type === "condition") return { groups: 0, conditions: 1 };
  const totals = { groups: 1, conditions: 0 };
  for (const child of node.children) {
    const sub = countNodes(child);
    totals.groups += sub.groups;
    totals.conditions += sub.conditions;
  }
  return totals;
}

/**
 * Flatten a single-level AND/OR group into DatasetQuery.
 * Nested groups or NOT return undefined so the host can keep a tree evaluator.
 */
export function compileToDatasetQuery(node: FilterNode, sort?: SortClause[]): DatasetQuery | undefined {
  if (node.type === "condition") {
    return { filters: [conditionClause(node)], filterLogic: "and", sort };
  }
  if (node.combinator === "NOT") return undefined;
  if (node.children.some((child) => child.type === "group")) return undefined;
  const filters = node.children
    .filter((child): child is ConditionNode => child.type === "condition")
    .map(conditionClause);
  return { filters, filterLogic: node.combinator === "OR" ? "or" : "and", sort };
}

/**
 * Compile any filter tree to a DatasetQuery: flat `filters`/`filterLogic` when
 * the tree flattens losslessly, `filterTree` otherwise. Never returns undefined,
 * so a nested or NOT search can no longer silently clear a downstream filter.
 */
export function toDatasetQuery(node: FilterNode, sort?: SortClause[]): DatasetQuery {
  const flat = compileToDatasetQuery(node, sort);
  if (flat) return flat;
  if (node.type === "group") return { filterTree: node, sort };
  return { filters: [], filterLogic: "and", sort };
}

/**
 * Structural canonical form of a filter tree: node ids are session-random
 * (`uid`), so they are stripped and children order is preserved. Equivalent
 * trees built in different sessions produce identical JSON — this is what
 * `queryKey` folds into cache identity.
 */
export function canonicalFilterTree(node: FilterNode): unknown {
  if (node.type === "condition") {
    return { type: "condition", field: node.field, operator: node.operator, value: node.value ?? null };
  }
  return {
    type: "group",
    combinator: node.combinator,
    children: node.children.map(canonicalFilterTree),
  };
}

export { filterRows, matchClauses };
