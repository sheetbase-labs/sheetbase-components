import type { FieldDataType, FilterNode, GroupNode } from '@sheetbase-labs/sheetbase-shared'

/**
 * Cross-executor filter parity cases. `buildPredicate` is the reference; the
 * DuckDB compiler (sql-compile.ts) and the Python/Ibis compiler must return
 * the same row ids. `parity.test.ts` regenerates `fixtures/filter-parity.json`
 * with UPDATE_PARITY=1; the Python tests read that file.
 */

export const PARITY_NOW = '2026-03-15T12:00:00.000Z'

export const PARITY_FIELDS: { id: string; dataType: FieldDataType }[] = [
  { id: 'id', dataType: 'text' },
  { id: 'status', dataType: 'text' },
  { id: 'result', dataType: 'number' },
  { id: 'count', dataType: 'number' },
  { id: 'passed', dataType: 'boolean' },
  { id: 'collected', dataType: 'date' },
  { id: 'measured_at', dataType: 'datetime' },
  { id: 'code', dataType: 'text' },
  { id: 'notes', dataType: 'text' },
]

export const PARITY_ROWS: Record<string, unknown>[] = [
  { id: 'r01', status: 'Complete', result: 42.5, count: 3, passed: true, collected: '2026-03-15', measured_at: '2026-03-15T08:30:00.000Z', code: '007', notes: "O'Brien sample" },
  { id: 'r02', status: 'complete', result: -1.25, count: 0, passed: false, collected: '2026-03-10', measured_at: '2026-03-10T23:59:59.000Z', code: '1,200', notes: '50% recovery' },
  { id: 'r03', status: 'Pending', result: null, count: 12, passed: null, collected: null, measured_at: null, code: '12.5', notes: 'under_score' },
  { id: 'r04', status: '', result: 0, count: 7, passed: true, collected: '2025-12-31', measured_at: '2025-12-31T00:00:00.000Z', code: 'abc', notes: '"quoted"' },
  { id: 'r05', status: null, result: 100, count: 1, passed: false, collected: '2026-03-14', measured_at: '2026-03-14T12:00:00.000Z', code: '2024-03-01', notes: '' },
  { id: 'r06', status: 'Failed', result: 99.999, count: 120, passed: true, collected: '2026-01-01', measured_at: '2026-01-01T06:00:00.000Z', code: '', notes: null },
  { id: 'r07', status: '  Complete  ', result: 7, count: 7, passed: null, collected: '2026-03-08', measured_at: '2026-03-08T12:00:00.000Z', code: null, notes: 'Contains Complete' },
  { id: 'r08', status: 'REVIEW', result: 1e6, count: 2, passed: false, collected: '2024-02-29', measured_at: '2024-02-29T18:45:00.000Z', code: '7', notes: 'leap day' },
  { id: 'r09', status: 'Pending', result: 0.1, count: 5, passed: true, collected: '2026-03-15', measured_at: '2026-03-15T11:59:59.000Z', code: '-3', notes: 'TRUE' },
  { id: 'r10', status: 'Complete', result: 50, count: 50, passed: true, collected: '2026-02-15', measured_at: '2026-02-15T00:00:00.000Z', code: '50', notes: 'yes' },
]

let nextId = 0
function c(field: string, operator: string, value?: unknown): FilterNode {
  nextId += 1
  return { type: 'condition', id: `c${nextId}`, field, operator: operator as never, ...(value === undefined ? {} : { value }) }
}
function g(combinator: 'AND' | 'OR' | 'NOT', ...children: FilterNode[]): GroupNode {
  nextId += 1
  return { type: 'group', id: `g${nextId}`, combinator, children }
}
const root = (...children: FilterNode[]) => g('AND', ...children)

export const PARITY_CASES: { name: string; filter: GroupNode }[] = [
  { name: 'empty AND matches all', filter: root() },
  { name: 'empty OR matches none', filter: g('OR') },
  { name: 'empty NOT matches all', filter: g('NOT') },
  // Text
  { name: 'text eq is case-insensitive', filter: root(c('status', 'eq', 'complete')) },
  { name: 'text eq does not trim', filter: root(c('status', 'eq', 'Complete')) },
  { name: 'text eq empty matches null and blank', filter: root(c('status', 'eq', '')) },
  { name: 'text neq keeps nulls', filter: root(c('status', 'neq', 'Pending')) },
  { name: 'text contains', filter: root(c('notes', 'contains', 'complete')) },
  { name: 'text contains percent literally', filter: root(c('notes', 'contains', '50%')) },
  { name: 'text contains underscore literally', filter: root(c('notes', 'contains', 'r_s')) },
  { name: 'text contains apostrophe', filter: root(c('notes', 'contains', "o'brien")) },
  { name: 'text startsWith', filter: root(c('status', 'startsWith', 'pe')) },
  { name: 'text endsWith', filter: root(c('notes', 'endsWith', 'DAY')) },
  { name: 'text in', filter: root(c('status', 'in', ['failed', 'review'])) },
  { name: 'text isNull counts blank', filter: root(c('status', 'isNull')) },
  { name: 'text notNull', filter: root(c('notes', 'notNull')) },
  // Numeric text column (looseEqual numeric arm)
  { name: 'numeric text eq number', filter: root(c('code', 'eq', 7)) },
  { name: 'numeric text eq grouped', filter: root(c('code', 'eq', '1200')) },
  { name: 'numeric text gt', filter: root(c('code', 'gt', 10)) },
  { name: 'numeric text lt negative', filter: root(c('code', 'lt', 0)) },
  { name: 'text date-like gt date', filter: root(c('code', 'gt', '2020-01-01')) },
  { name: 'text eq date', filter: root(c('code', 'eq', '2024-03-01')) },
  // Numbers
  { name: 'number eq', filter: root(c('result', 'eq', 50)) },
  { name: 'number eq string', filter: root(c('result', 'eq', '42.5')) },
  { name: 'number eq zero', filter: root(c('result', 'eq', 0)) },
  { name: 'number neq keeps nulls', filter: root(c('result', 'neq', 50)) },
  { name: 'number gt', filter: root(c('result', 'gt', 42.5)) },
  { name: 'number gte', filter: root(c('result', 'gte', 42.5)) },
  { name: 'number lt', filter: root(c('result', 'lt', 1)) },
  { name: 'number lte', filter: root(c('count', 'lte', 3)) },
  { name: 'number between', filter: root(c('result', 'between', [0, 50])) },
  { name: 'number between reversed', filter: root(c('result', 'between', [50, 0])) },
  { name: 'number between object bounds', filter: root(c('count', 'between', { low: 2, high: 7 })) },
  { name: 'number between mixed kinds matches none', filter: root(c('result', 'between', [0, '2026-01-01'])) },
  { name: 'number gt date matches none', filter: root(c('result', 'gt', '2026-01-01')) },
  { name: 'number in', filter: root(c('count', 'in', [7, '12', 'x'])) },
  { name: 'number isNull', filter: root(c('result', 'isNull')) },
  { name: 'number eq text', filter: root(c('result', 'eq', 'abc')) },
  { name: 'number contains digit', filter: root(c('count', 'contains', '2')) },
  { name: 'number startsWith', filter: root(c('result', 'startsWith', '9')) },
  // Booleans
  { name: 'boolean eq true', filter: root(c('passed', 'eq', true)) },
  { name: 'boolean eq false', filter: root(c('passed', 'eq', false)) },
  { name: 'boolean eq "true" text', filter: root(c('passed', 'eq', 'true')) },
  { name: 'boolean neq true keeps nulls', filter: root(c('passed', 'neq', true)) },
  { name: 'boolean isNull', filter: root(c('passed', 'isNull')) },
  { name: 'text eq true via boolean set', filter: root(c('notes', 'eq', true)) },
  // Dates
  { name: 'date eq', filter: root(c('collected', 'eq', '2026-03-15')) },
  { name: 'date gt', filter: root(c('collected', 'gt', '2026-03-01')) },
  { name: 'date lt', filter: root(c('collected', 'lt', '2026-01-01')) },
  { name: 'date between', filter: root(c('collected', 'between', ['2026-01-01', '2026-03-10'])) },
  { name: 'date gt number matches none', filter: root(c('collected', 'gt', 5)) },
  { name: 'date within last 1 day', filter: root(c('collected', 'withinLastDays', 1)) },
  { name: 'date within last 7 days', filter: root(c('collected', 'withinLastDays', 7)) },
  { name: 'date within bad days matches none', filter: root(c('collected', 'withinLastDays', 0)) },
  { name: 'date isNull', filter: root(c('collected', 'isNull')) },
  { name: 'datetime gt instant', filter: root(c('measured_at', 'gt', '2026-03-14T12:00:00.000Z')) },
  { name: 'datetime gte date', filter: root(c('measured_at', 'gte', '2026-03-10')) },
  { name: 'datetime eq instant', filter: root(c('measured_at', 'eq', '2026-03-08T12:00:00.000Z')) },
  { name: 'datetime within last 6 days', filter: root(c('measured_at', 'withinLastDays', 6)) },
  { name: 'text date within last days', filter: root(c('code', 'withinLastDays', 1000)) },
  // Groups
  { name: 'AND of two', filter: root(c('status', 'eq', 'complete'), c('result', 'gt', 0)) },
  { name: 'OR of two', filter: g('OR', c('status', 'eq', 'failed'), c('count', 'gte', 50)) },
  { name: 'NOT is NOR', filter: g('NOT', c('status', 'eq', 'complete'), c('passed', 'eq', false)) },
  { name: 'NOT with nulls', filter: g('NOT', c('result', 'gt', 10)) },
  { name: 'nested AND(OR, NOT)', filter: root(g('OR', c('status', 'eq', 'pending'), c('status', 'eq', 'complete')), g('NOT', c('collected', 'lt', '2026-03-01'))) },
  { name: 'nested empty groups', filter: root(g('AND'), g('NOT'), c('count', 'gt', 5)) },
  { name: 'nested empty OR blocks', filter: root(g('OR'), c('count', 'gt', 5)) },
  // Field lookup
  { name: 'field name is case-insensitive', filter: root(c('STATUS', 'eq', 'pending')) },
  { name: 'unknown field eq empty matches all', filter: root(c('missing', 'eq', '')) },
  { name: 'unknown field isNull matches all', filter: root(c('missing', 'isNull')) },
  { name: 'unknown field gt matches none', filter: root(c('missing', 'gt', 1)) },
]
