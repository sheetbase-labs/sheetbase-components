import type { ConditionNode, FilterNode, GroupNode } from 'sheetbase-shared'
import type { FilterRule } from './types'

/**
 * Convert between the shared analysis filter tree and the explorer's flat rule
 * list. Nested groups are flattened leaf-by-leaf: the explorer edits a single
 * AND/OR level, so a tree built elsewhere collapses to its conditions here.
 */
function ruleFromCondition(node: ConditionNode): FilterRule {
  const base = { id: node.id, field: node.field, operator: node.operator }
  if (node.operator === 'between') {
    const pair = Array.isArray(node.value) ? node.value : []
    return { ...base, value: pair[0] === undefined ? '' : String(pair[0]), value2: pair[1] === undefined ? '' : String(pair[1]) }
  }
  if (node.operator === 'in') {
    return { ...base, values: Array.isArray(node.value) ? node.value.map((value) => String(value)) : [] }
  }
  return { ...base, value: node.value === undefined || node.value === null ? '' : String(node.value) }
}

export function filtersFromTree(node: FilterNode): { rules: FilterRule[]; logic: 'and' | 'or' } {
  if (node.type === 'condition') return { rules: [ruleFromCondition(node)], logic: 'and' }
  const rules: FilterRule[] = []
  const walk = (child: FilterNode) => {
    if (child.type === 'condition') rules.push(ruleFromCondition(child))
    else child.children.forEach(walk)
  }
  node.children.forEach(walk)
  return { rules, logic: node.combinator === 'OR' ? 'or' : 'and' }
}

let fallbackId = 0

function conditionFromRule(rule: FilterRule): ConditionNode {
  const value = rule.operator === 'between'
    ? [rule.value ?? '', rule.value2 ?? '']
    : rule.operator === 'in'
      ? (rule.values ?? [])
      : rule.value ?? ''
  return { type: 'condition', id: rule.id || `view_cnd_${fallbackId++}`, field: rule.field, operator: rule.operator, value }
}

export function treeFromFilters(rules: readonly FilterRule[], logic: 'and' | 'or'): GroupNode {
  return { type: 'group', id: 'view-filter', combinator: logic === 'or' ? 'OR' : 'AND', children: rules.map(conditionFromRule) }
}
