import type { SortDirection } from "./query";
import type { FilterNode, GroupNode, SearchSpec } from "./tree";
import { applySearch, emptyRoot } from "./tree";

/** How grouped rows are summarised — shared by search and charting. */
export type SummaryKind = "none" | "mean" | "median" | "sum" | "count" | "min" | "max";

/**
 * The analysis half of a view: which rows to keep (a filter tree), how to group
 * and summarise them, and their order/cap. Search owns the whole thing; the
 * explorer maps it onto chart channels. Hosts keep one `AnalysisView` and pass
 * it to both, so editing either component updates the other.
 */
export type AnalysisView = Readonly<{
  filter: GroupNode;
  groupBy?: string;
  summary: SummaryKind;
  sort?: { field: string; direction: SortDirection };
  limit?: number;
}>;

export function emptyView(summary: SummaryKind = "none"): AnalysisView {
  return { filter: emptyRoot(), summary };
}

/** The search-owned slice of a view. */
export function searchSpecFromView(view: AnalysisView): SearchSpec {
  return { filter: view.filter, groupBy: view.groupBy, sort: view.sort, limit: view.limit };
}

/** Wrap a search spec as a view, keeping any summary the view already had. */
export function viewFromSearchSpec(spec: SearchSpec, summary: SummaryKind = "none"): AnalysisView {
  return { filter: spec.filter, groupBy: spec.groupBy, summary, sort: spec.sort, limit: spec.limit };
}

/** Apply the view's filter, sort and limit to rows (grouping is left to charts). */
export function applyView<T extends Record<string, unknown>>(rows: readonly T[], view: AnalysisView): T[] {
  return applySearch(rows, searchSpecFromView(view));
}

/**
 * Restrict a view to the fields that exist: filter conditions on unknown
 * fields are pruned (child groups emptied by pruning collapse), and `groupBy`/
 * `sort` bindings to unknown fields are dropped. For hydrating a persisted
 * view or re-homing one onto a different dataset — a field the dataset does
 * not have must not compile into its queries. Returns the same object when
 * nothing is stale.
 */
export function pruneViewToFields(view: AnalysisView, fields: readonly { id: string }[]): AnalysisView {
  const known = new Set(fields.map((field) => field.id));
  // Persisted blobs aren't typed — a bare condition is a valid FilterNode and
  // its field can be stale just like a group's.
  const raw = view.filter as FilterNode | undefined;
  const filter =
    raw?.type === "group"
      ? pruneUnknownFields(raw, known)
      : raw?.type === "condition" && !known.has(raw.field)
        ? emptyRoot()
        : view.filter;
  const groupBy = view.groupBy !== undefined && !known.has(view.groupBy) ? undefined : view.groupBy;
  const sort = view.sort !== undefined && !known.has(view.sort.field) ? undefined : view.sort;
  return filter === view.filter && groupBy === view.groupBy && sort === view.sort
    ? view
    : { ...view, filter, groupBy, sort };
}

function pruneUnknownFields(group: GroupNode, known: ReadonlySet<string>): GroupNode {
  const children = group.children.flatMap((child): FilterNode[] => {
    if (child.type === "condition") return known.has(child.field) ? [child] : [];
    const pruned = pruneUnknownFields(child, known);
    return pruned.children.length > 0 ? [pruned] : [];
  });
  return children.length === group.children.length && children.every((child, index) => child === group.children[index])
    ? group
    : { ...group, children };
}
