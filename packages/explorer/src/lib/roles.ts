/**
 * COMP-03.4: the field-role model behind the Analysis screen's field list and
 * axis wells (`canvas/Analysis.dc.html`).
 *
 * A v3 figure is described by four roles — x (shared across a chart stack),
 * y (y1), y2 (the stack's second chart) and series — plus optional calculated
 * fields. These helpers map that model onto the explorer's `ChartSpec` so the
 * panel and the spec can never drift.
 */
import type { ChartSpec, ColumnKind, ColumnMeta, Dataset } from './types'

export type FieldRole = 'x' | 'y' | 'y2' | 'series'

export interface RoleWell {
  role: FieldRole
  label: string
  hint: string
}

/** The wells the design offers, in order. */
export const FIELD_ROLES: readonly RoleWell[] = [
  { role: 'x', label: 'X axis', hint: 'shared' },
  { role: 'y', label: 'Y axis', hint: 'chart 1' },
  { role: 'y2', label: 'Y2 axis', hint: 'chart 2' },
  { role: 'series', label: 'Series', hint: 'group' },
]

/** Short role tag shown beside a field in the list (design uses `y1`/`y2`). */
export const ROLE_CHIPS: Record<FieldRole, string> = {
  x: 'x',
  y: 'y1',
  y2: 'y2',
  series: 'series',
}

export interface ChartField {
  key: string
  label: string
  /** `calculated` fields carry an `expression` instead of a column. */
  kind: ColumnKind | 'calculated'
  /** Display unit ("L/m²", "NTU", "%"), shown beside the role. */
  unit?: string
  /** Expression for a calculated field. */
  expression?: string
}

export interface FieldRoleAssignment {
  x?: string
  y?: string
  y2?: string
  series?: string
}

/** The assignment a spec currently expresses. */
export function rolesFromSpec(spec: ChartSpec): FieldRoleAssignment {
  const series = spec.group ?? spec.color
  return {
    ...(spec.x === undefined ? {} : { x: spec.x }),
    ...(spec.y === undefined ? {} : { y: spec.y }),
    ...(spec.y2 === undefined ? {} : { y2: spec.y2 }),
    ...(series === undefined ? {} : { series }),
  }
}

/**
 * Assign (or with `key === undefined`, clear) a role on a spec. The series
 * role is the spec's `group`, and clearing it also clears `color` so a stale
 * colour dimension cannot survive an unassigned series.
 */
export function specWithRole(spec: ChartSpec, role: FieldRole, key: string | undefined): ChartSpec {
  if (role === 'x') return { ...spec, x: key, zoomX: undefined }
  if (role === 'y') return { ...spec, y: key }
  if (role === 'y2') return { ...spec, y2: key }
  return {
    ...spec,
    group: key,
    ...(key === undefined ? { color: undefined } : {}),
    hiddenSeries: [],
  }
}

/** Role a field currently holds, if any. */
export function roleOf(assignment: FieldRoleAssignment, key: string): FieldRole | undefined {
  return FIELD_ROLES.map((well) => well.role).find((role) => assignment[role] === key)
}

export interface ChartFieldOptions {
  /** Units by column key; the column contract carries none. */
  units?: Record<string, string>
  /** Calculated fields to append (design's "ƒx Step yield"). */
  calculated?: ChartField[]
}

/** Columns as panel fields, plus any calculated fields. */
export function chartFieldsFromDataset(dataset: Dataset, options: ChartFieldOptions = {}): ChartField[] {
  const columns: ColumnMeta[] = dataset.columns
  return [
    ...columns.map((column) => ({
      key: column.key,
      label: column.key,
      kind: column.kind,
      ...(options.units?.[column.key] === undefined ? {} : { unit: options.units[column.key] }),
    })),
    ...(options.calculated ?? []).map((field) => ({ ...field, kind: 'calculated' as const })),
  ]
}

/** Type glyph from the design's field list. */
export function fieldGlyph(kind: ChartField['kind']): string {
  if (kind === 'calculated') return 'ƒx'
  if (kind === 'number') return '#'
  if (kind === 'date') return '◷'
  if (kind === 'boolean') return '✓'
  return 'Aa'
}

/** Trailing hint beside a field: `L/m² · x`, `% · y1`, `series`, `bar`. */
export function fieldHint(field: ChartField, assignment: FieldRoleAssignment): string {
  const role = roleOf(assignment, field.key)
  return [field.unit, role ? ROLE_CHIPS[role] : undefined].filter(Boolean).join(' · ')
}
