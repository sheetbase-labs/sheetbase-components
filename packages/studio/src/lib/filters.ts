import type { FilterClause, FilterNode, GroupNode } from '@sheetbase-labs/sheetbase-shared'

/**
 * The filter a request applies: the tree when present (authoritative), else
 * the flat clauses rebuilt into a one-level group. Never undefined-as-"all"
 * for a request that carried clauses.
 */
export function effectiveFilter(request: {
  filterTree?: GroupNode
  filters?: readonly FilterClause[]
  filterLogic?: 'and' | 'or'
}): GroupNode | undefined {
  if (request.filterTree) return request.filterTree
  if (!request.filters?.length) return undefined
  const children: FilterNode[] = request.filters.map((clause, index) => ({
    type: 'condition',
    id: `flat_${index}`,
    field: clause.fieldId,
    operator: clause.operator,
    value: clause.value,
  }))
  return { type: 'group', id: 'flat', combinator: request.filterLogic === 'or' ? 'OR' : 'AND', children }
}

/** Throw the platform's AbortError when a request was cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
