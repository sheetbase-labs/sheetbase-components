import type { SortDirection } from "./query";
import type { GroupNode, SearchSpec } from "./tree";
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
