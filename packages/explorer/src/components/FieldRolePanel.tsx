/**
 * COMP-03.4: the v3 field-role panel (`canvas/Analysis.dc.html`).
 *
 * The field list with each field's role ("L/m² · x", "NTU · y2") is the drag
 * source; the axis wells (x, y, y2, series) are the drop targets. A field can
 * also be picked and then placed in a well, so the panel works by keyboard and
 * on touch. "+ Calculated field" adds an `ƒx` field through the host.
 */
import { useId, useState, type DragEvent as ReactDragEvent } from 'react'
import {
  FIELD_ROLES, fieldGlyph, fieldHint, roleOf,
  type ChartField, type FieldRole, type FieldRoleAssignment,
} from '../lib/roles'

export interface FieldRolePanelSource {
  label: string
  value?: string
  options: Array<{ id: string; label: string }>
  onChange?(id: string): void
  /** Join/subtitle line under the source select (design: "+ DS-0310 joined on Condition"). */
  note?: string
}

export interface FieldRolePanelProps {
  fields: ChartField[]
  /** Current assignment (see `rolesFromSpec`). */
  roles: FieldRoleAssignment
  /** Assign or, with `undefined`, clear a role. */
  onAssign(role: FieldRole, key: string | undefined): void
  onAddCalculatedField?(field: { label: string; expression: string }): void
  source?: FieldRolePanelSource
  /** Caption above the list; defaults to the design's wording. */
  heading?: string
  className?: string
}

export function FieldRolePanel({
  fields, roles, onAssign, onAddCalculatedField, source, heading, className,
}: FieldRolePanelProps) {
  const [selected, setSelected] = useState<string | undefined>()
  const [dragOver, setDragOver] = useState<FieldRole | undefined>()
  const [calculating, setCalculating] = useState(false)
  const [calcLabel, setCalcLabel] = useState('')
  const [calcExpression, setCalcExpression] = useState('')
  const formId = useId()

  function drop(event: ReactDragEvent<HTMLElement>, role: FieldRole) {
    event.preventDefault()
    setDragOver(undefined)
    const key = event.dataTransfer.getData('text/plain') || selected
    if (key) onAssign(role, key)
  }

  function submitCalculated() {
    const label = calcLabel.trim()
    const expression = calcExpression.trim()
    if (!label || !expression) return
    onAddCalculatedField?.({ label, expression })
    setCalcLabel('')
    setCalcExpression('')
    setCalculating(false)
  }

  return (
    <aside className={className ? `sb-field-roles ${className}` : 'sb-field-roles'} aria-label="Chart fields">
      {source ? (
        <div className="sb-field-roles__source">
          <div className="sb-field-roles__caption">Source</div>
          <div className="sb-field-roles__select">
            <select aria-label={source.label} value={source.value ?? ''} onChange={(event) => source.onChange?.(event.target.value)}>
              {source.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <span aria-hidden="true">▾</span>
          </div>
          {source.note ? <div className="sb-field-roles__note">{source.note}</div> : null}
        </div>
      ) : null}

      <div className="sb-field-roles__caption">{heading ?? 'Fields · drag onto an axis'}</div>
      <ul className="sb-field-list">
        {fields.map((field) => {
          const role = roleOf(roles, field.key)
          const hint = fieldHint(field, roles)
          return (
            <li key={field.key}>
              <button
                type="button"
                className={`sb-field${role ? ' is-assigned' : ''}${selected === field.key ? ' is-selected' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', field.key)
                  event.dataTransfer.effectAllowed = 'copy'
                  setSelected(field.key)
                }}
                onClick={() => setSelected((current) => current === field.key ? undefined : field.key)}
                aria-pressed={selected === field.key}
                title={field.expression ? `${field.label} = ${field.expression}` : field.label}
              >
                <span className="sb-field__type">{fieldGlyph(field.kind)}</span>
                <span className="sb-field__name">{field.label}</span>
                <span className="sb-field__hint">{hint}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="sb-role-wells">
        {FIELD_ROLES.map((well) => {
          const key = roles[well.role]
          const field = fields.find((candidate) => candidate.key === key)
          const armed = selected !== undefined
          return (
            <div
              key={well.role}
              className={`sb-role-well${field ? ' is-set' : ''}${dragOver === well.role ? ' is-drop' : ''}`}
            >
              <span className="sb-role-well__label">
                {well.label}
                <small>{well.hint}</small>
              </span>
              <button
                type="button"
                className="sb-role-well__value"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  if (dragOver !== well.role) setDragOver(well.role)
                }}
                onDragLeave={() => setDragOver((current) => current === well.role ? undefined : current)}
                onDrop={(event) => drop(event, well.role)}
                onClick={() => {
                  const pick = selected ?? field?.key
                  if (pick) onAssign(well.role, pick)
                }}
                aria-label={`${well.label}: ${field?.label ?? 'empty'}`}
              >
                {field?.label ?? (armed ? 'Assign selected field' : 'Drag a field')}
              </button>
              {field ? (
                <button
                  type="button"
                  className="sb-role-well__clear"
                  aria-label={`Clear ${well.label}`}
                  onClick={() => onAssign(well.role, undefined)}
                >
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {onAddCalculatedField ? (
        calculating ? (
          <form
            className="sb-calc-field"
            onSubmit={(event) => {
              event.preventDefault()
              submitCalculated()
            }}
          >
            <label htmlFor={`${formId}-name`}>Name</label>
            <input id={`${formId}-name`} value={calcLabel} onChange={(event) => setCalcLabel(event.target.value)} placeholder="Step yield" />
            <label htmlFor={`${formId}-expression`}>Expression</label>
            <input
              id={`${formId}-expression`}
              value={calcExpression}
              onChange={(event) => setCalcExpression(event.target.value)}
              placeholder="titre_out / titre_in"
            />
            <div className="sb-calc-field__actions">
              <button type="submit" className="sb-btn primary" disabled={!calcLabel.trim() || !calcExpression.trim()}>Add field</button>
              <button type="button" className="sb-btn" onClick={() => setCalculating(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="sb-field-add" onClick={() => setCalculating(true)}>+ Calculated field</button>
        )
      ) : null}
    </aside>
  )
}
