import { memo, useCallback, useMemo, useRef, useState, type DragEvent, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { DatasetQuery, FilterClause, FilterOperator } from "../data";
import type { ColumnPresentation } from "./presentation-state";
import { buildFilterValue, ensureOperator, filterValueSummary, operatorLabel, operatorsForField, type TableControlsField } from "./filter-conditions";
import { usePortalPopover } from "./use-portal-popover";

export type TableControlsProps = Readonly<{
  fields: readonly TableControlsField[];
  query: DatasetQuery;
  onQueryChange(query: DatasetQuery): void;
  columns: readonly ColumnPresentation[];
  onColumnsChange(columns: readonly ColumnPresentation[]): void;
  onFrozenColumnsChange?(frozenColumns: number): void;
  theme?: "light" | "dark";
}>;

type PanelId = "filters" | "columns";
type BuilderState = Readonly<{ fieldId: string; operator: FilterOperator; value: string; value2: string; values: readonly string[] }>;

const emptyBuilder = (fieldId: string): BuilderState => ({ fieldId, operator: "eq", value: "", value2: "", values: [] });

/**
 * Controlled Filters and Columns toolbar controls, rendered through portal popovers
 * so table overflow clipping cannot hide them. Keyboard contract: Escape closes and
 * restores focus to the trigger, Tab wraps inside the popover, and focus leaving the
 * popover closes it.
 */
export const TableControls = memo(function TableControls({ fields, query, onQueryChange, columns, onColumnsChange, onFrozenColumnsChange, theme = "light" }: TableControlsProps) {
  const [open, setOpen] = useState<PanelId>();
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [columnSearch, setColumnSearch] = useState("");
  const [dragOverFieldId, setDragOverFieldId] = useState<string>();
  const [builder, setBuilder] = useState<BuilderState>(() => emptyBuilder(fields[0]?.id ?? ""));
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerElement = useRef<HTMLElement | null>(null);
  const dragSource = useRef<{ index: number; fieldId: string } | null>(null);

  const close = useCallback(() => setOpen(undefined), []);
  const popover = usePortalPopover(open !== undefined, close, { popover: popoverRef, root: rootRef, trigger: triggerElement });

  const toggle = useCallback((panel: PanelId, event: MouseEvent<HTMLButtonElement>) => {
    triggerElement.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPosition({ top: bounds.bottom + 5, right: Math.max(8, window.innerWidth - bounds.right) });
    setOpen((current) => current === panel ? undefined : panel);
  }, []);

  const filters = useMemo(() => query.filters ?? [], [query.filters]);
  const fieldLabels = useMemo(() => Object.fromEntries(fields.map((field) => [field.id, field.label])), [fields]);
  const searchable = columnSearch.trim().toLocaleLowerCase();
  const visibleRows = useMemo(() => {
    const rows: { column: ColumnPresentation; index: number }[] = [];
    columns.forEach((column, index) => {
      const label = fieldLabels[column.fieldId] ?? column.fieldId;
      if (!searchable || label.toLocaleLowerCase().includes(searchable) || column.fieldId.toLocaleLowerCase().includes(searchable)) rows.push({ column, index });
    });
    return rows;
  }, [columns, fieldLabels, searchable]);

  const addFilter = useCallback((clause: FilterClause) => {
    onQueryChange({ ...query, filters: [...filters, clause] });
  }, [filters, onQueryChange, query]);

  const removeFilter = useCallback((index: number) => {
    onQueryChange({ ...query, filters: filters.filter((_, item) => item !== index) });
  }, [filters, onQueryChange, query]);

  const resetColumns = useCallback(() => {
    onColumnsChange(fields.map((field) => ({ fieldId: field.id })));
    onFrozenColumnsChange?.(0);
  }, [fields, onColumnsChange, onFrozenColumnsChange]);

  const reorderColumns = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return;
    const next = [...columns];
    const [moving] = next.splice(from, 1);
    next.splice(to, 0, moving!);
    onColumnsChange(next);
  }, [columns, onColumnsChange]);

  const startDrag = useCallback((index: number, fieldId: string, event: DragEvent<HTMLLIElement>) => {
    dragSource.current = { index, fieldId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", fieldId);
  }, []);

  const dragOverRow = useCallback((fieldId: string, event: DragEvent<HTMLLIElement>) => {
    if (!dragSource.current || dragSource.current.fieldId === fieldId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverFieldId(fieldId);
  }, []);

  const dropOnRow = useCallback((fieldId: string, event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const source = dragSource.current;
    dragSource.current = null;
    setDragOverFieldId(undefined);
    if (!source || source.fieldId === fieldId) return;
    reorderColumns(source.index, columns.findIndex((column) => column.fieldId === fieldId));
  }, [columns, reorderColumns]);

  const endDrag = useCallback(() => {
    dragSource.current = null;
    setDragOverFieldId(undefined);
  }, []);

  const popoverProps = (panel: PanelId, label: string, id: string) => ({
    ref: popoverRef,
    id,
    role: "dialog" as const,
    "aria-label": label,
    className: `sheetbase-scope toolbar-popover ${panel === "filters" ? "filter-builder" : "column-picker column-manager"}`,
    "data-theme": theme,
    style: position,
    onKeyDown: popover.onKeyDown,
    onBlur: (event: FocusEvent) => popover.onBlurOut(event),
  });

  return <div className="view-controls" ref={rootRef}>
    <button className={open === "filters" ? "active" : ""} aria-expanded={open === "filters"} aria-haspopup="dialog" aria-controls="table-controls-filters" onClick={(event) => toggle("filters", event)}>
      Filters{filters.length > 0 && <small>{filters.length}</small>}
    </button>
    <button className={open === "columns" ? "active" : ""} aria-expanded={open === "columns"} aria-haspopup="dialog" aria-controls="table-controls-columns" onClick={(event) => toggle("columns", event)}>
      Columns
    </button>
    {open && typeof document !== "undefined" && createPortal(
      open === "filters"
        ? <div {...popoverProps("filters", "Filters", "table-controls-filters")}>
          <header>
            <span>Filters</span>
            {filters.length > 1 && <select aria-label="Filter logic" value={query.filterLogic ?? "and"} onChange={(event) => onQueryChange({ ...query, filterLogic: event.target.value as "and" | "or" })}>
              <option value="and">Match all</option>
              <option value="or">Match any</option>
            </select>}
          </header>
          {filters.length > 0 && <div className="active-filters" aria-label="Active filters">
            {filters.map((filter, index) => <FilterChip key={`${filter.fieldId}-${index}`} filter={filter} label={fieldLabels[filter.fieldId] ?? filter.fieldId} onRemove={() => removeFilter(index)} />)}
          </div>}
          <FilterBuilder fields={fields} builder={builder} onBuilder={setBuilder} pending={addFilter} />
        </div>
        : <div {...popoverProps("columns", "Columns", "table-controls-columns")}>
          <header>
            <span>Columns</span>
            <button onClick={resetColumns}>Reset</button>
          </header>
          <input aria-label="Search columns" placeholder="Search fields…" value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} />
          <ul className="column-manager-list" aria-label="Column order">
            {visibleRows.map(({ column, index }) => <ColumnRow
              key={column.fieldId}
              column={column}
              index={index}
              last={index === columns.length - 1}
              label={fieldLabels[column.fieldId] ?? column.fieldId}
              dragOver={dragOverFieldId === column.fieldId}
              onToggleVisibility={() => onColumnsChange(columns.map((candidate) => candidate.fieldId === column.fieldId ? { ...candidate, hidden: !candidate.hidden } : candidate))}
              onMove={(direction) => reorderColumns(index, index + direction)}
              onDragStart={(event) => startDrag(index, column.fieldId, event)}
              onDragOver={(event) => dragOverRow(column.fieldId, event)}
              onDrop={(event) => dropOnRow(column.fieldId, event)}
              onDragEnd={endDrag}
            />)}
          </ul>
        </div>,
      document.body,
    )}
  </div>;
});

function FilterChip({ filter, label, onRemove }: Readonly<{ filter: FilterClause; label: string; onRemove(): void }>) {
  const summary = filterValueSummary(filter);
  return <div className="filter-chip">
    <span>{label}</span>
    <small>{operatorLabel(filter.operator)}{summary ? ` ${summary}` : ""}</small>
    <button aria-label={`Remove filter ${label}`} onClick={onRemove}>×</button>
  </div>;
}

function FilterBuilder({ fields, builder, onBuilder, pending }: Readonly<{
  fields: readonly TableControlsField[];
  builder: BuilderState;
  onBuilder(next: BuilderState): void;
  pending(clause: FilterClause): void;
}>) {
  const field = fields.find((candidate) => candidate.id === builder.fieldId) ?? fields[0];
  if (!field) return null;
  const operators = operatorsForField(field);
  const built = buildFilterValue(field, builder.operator, { value: builder.value, value2: builder.value2, values: builder.values });
  const add = () => {
    if (!built) return;
    pending({ fieldId: field.id, operator: builder.operator, ...built });
    onBuilder({ ...builder, value: "", value2: "", values: [] });
  };
  return <div className="filter-builder-form">
    <select aria-label="Filter field" value={field.id} onChange={(event) => onBuilder((() => {
      const next = fields.find((candidate) => candidate.id === event.target.value);
      return { ...builder, fieldId: event.target.value, operator: next ? ensureOperator(next, builder.operator) : builder.operator };
    })())}>
      {fields.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
    </select>
    <select aria-label="Filter operator" value={builder.operator} onChange={(event) => onBuilder({ ...builder, operator: event.target.value as FilterOperator })}>
      {operators.map((operator) => <option key={operator} value={operator}>{operatorLabel(operator, field)}</option>)}
    </select>
    <FilterValueControls field={field} operator={builder.operator} builder={builder} onBuilder={onBuilder} />
    <button className="filter-add" disabled={!built} onClick={add}>Add filter</button>
  </div>;
}

function FilterValueControls({ field, operator, builder, onBuilder }: Readonly<{
  field: TableControlsField;
  operator: FilterOperator;
  builder: BuilderState;
  onBuilder(next: BuilderState): void;
}>) {
  if (operator === "isNull" || operator === "notNull") return null;
  if (operator === "in" && field.options) {
    const selected = new Set(builder.values);
    return <fieldset className="filter-options" aria-label="Filter values">
      {field.options.map((option) => <label key={option}>
        <input type="checkbox" checked={selected.has(option)} onChange={(event) => onBuilder({
          ...builder,
          values: event.target.checked ? [...builder.values, option] : builder.values.filter((entry) => entry !== option),
        })} />
        <span>{option}</span>
      </label>)}
    </fieldset>;
  }
  if (operator === "between") {
    const type = field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text";
    return <div className="filter-between">
      <input aria-label="Minimum value" type={type} value={builder.value} onChange={(event) => onBuilder({ ...builder, value: event.target.value })} />
      <input aria-label="Maximum value" type={type} value={builder.value2} onChange={(event) => onBuilder({ ...builder, value2: event.target.value })} />
    </div>;
  }
  if (operator === "withinLastDays") {
    return <input aria-label="Number of days" type="number" min={1} value={builder.value} onChange={(event) => onBuilder({ ...builder, value: event.target.value })} />;
  }
  if (field.options && (operator === "eq" || operator === "neq")) {
    return <select aria-label="Filter value" value={builder.value} onChange={(event) => onBuilder({ ...builder, value: event.target.value })}>
      <option value="">Choose…</option>
      {field.options.map((option) => <option key={option}>{option}</option>)}
    </select>;
  }
  if (field.dataType === "boolean") {
    return <select aria-label="Filter value" value={builder.value} onChange={(event) => onBuilder({ ...builder, value: event.target.value })}>
      <option value="true">True</option>
      <option value="false">False</option>
    </select>;
  }
  const type = field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text";
  return <input aria-label="Filter value" type={type} value={builder.value} onChange={(event) => onBuilder({ ...builder, value: event.target.value })} />;
}

function ColumnRow({ column, index, last, label, dragOver, onToggleVisibility, onMove, onDragStart, onDragOver, onDrop, onDragEnd }: Readonly<{
  column: ColumnPresentation;
  index: number;
  last: boolean;
  label: string;
  dragOver: boolean;
  onToggleVisibility(): void;
  onMove(direction: -1 | 1): void;
  onDragStart(event: DragEvent<HTMLLIElement>): void;
  onDragOver(event: DragEvent<HTMLLIElement>): void;
  onDrop(event: DragEvent<HTMLLIElement>): void;
  onDragEnd(): void;
}>) {
  return <li
    className={`column-manager-row${dragOver ? " drag-over" : ""}`}
    draggable
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
  >
    <span className="drag-handle" aria-hidden="true">⠿</span>
    <label>
      <input type="checkbox" checked={!column.hidden} onChange={onToggleVisibility} />
      <span>{label}</span>
    </label>
    <small>{column.width ? `${Math.round(column.width)}px` : "Auto"}</small>
    <button aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
    <button aria-label={`Move ${label} down`} disabled={last} onClick={() => onMove(1)}>↓</button>
  </li>;
}
