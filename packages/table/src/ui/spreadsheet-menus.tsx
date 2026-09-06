import { useState } from "react";
import { columnLabel } from "../engine";
import type { DatasetQuery, FilterOperator } from "../data";
import { buildFilterValue, ensureOperator, operatorLabel, operatorsForField } from "./filter-conditions";
import type { DatasetHeaderConfig, SpreadsheetMenuAction } from "./spreadsheet-types";

/** Checkbox editor for option fields marked `multiple`; commits a comma-joined value. */
export function MultiOptionPicker({ options, current, onCommit, onCancel }: Readonly<{
  options: readonly string[];
  current: string;
  onCommit(value: string): void;
  onCancel(): void;
}>) {
  const selected = new Set(current.split(",").map((entry) => entry.trim()).filter((entry) => options.includes(entry)));
  const [picked, setPicked] = useState<Set<string>>(selected);
  return <div className="typed-options multi" role="group" aria-label="Choose values">
    {options.map((option) => <label key={option}>
      <input
        type="checkbox"
        checked={picked.has(option)}
        onChange={(event) => setPicked((currentPicked) => {
          const next = new Set(currentPicked);
          if (event.target.checked) next.add(option); else next.delete(option);
          return next;
        })}
      />
      <span>{option}</span>
    </label>)}
    <button className="multi-apply" onClick={() => onCommit([...picked].join(", "))}>Apply</button>
    <button onClick={onCancel}>Cancel</button>
  </div>;
}

export function menuKeys(onClose: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), select, input"));
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next]!.focus();
  };
}

export function ColumnContextMenu({ x, y, column, field, query, onQueryChange, onAutoFit, onHide, onMove, onFreeze, onUnfreeze, onFormat, actions, onClose }: Readonly<{
  x: number; y: number; column: number;
  field?: DatasetHeaderConfig["fields"][number]; query: DatasetQuery;
  onQueryChange?(query: DatasetQuery): void; onAutoFit(): void; onHide?(): void;
  onMove?(direction: -1 | 1): void; onFreeze(): void; onUnfreeze?(): void; onFormat?(): void; onClose(): void;
  actions?: readonly SpreadsheetMenuAction[];
}>) {
  const existing = field ? query.filters?.find((filter) => filter.fieldId === field.id) : undefined;
  const [operator, setOperator] = useState<FilterOperator>(() => field ? ensureOperator(field, existing?.operator ?? "eq") : "eq");
  const [value, setValue] = useState(existing && !Array.isArray(existing.value) && existing.value != null ? String(existing.value) : "");
  const [value2, setValue2] = useState(existing?.operator === "between" && Array.isArray(existing.value) && existing.value[1] != null ? String(existing.value[1]) : "");
  const [values, setValues] = useState<readonly string[]>(existing?.operator === "in" && Array.isArray(existing.value) ? existing.value.map(String) : []);
  const sorts = query.sort ?? [];
  const sortIndex = field ? sorts.findIndex((sort) => sort.fieldId === field.id) : -1;
  const setSort = (direction?: "asc" | "desc") => {
    if (!field) return;
    const other = sorts.filter((sort) => sort.fieldId !== field.id);
    onQueryChange?.({ ...query, sort: direction ? [...other, { fieldId: field.id, direction }] : other });
  };
  const applyFilter = () => {
    if (!field) return;
    const other = (query.filters ?? []).filter((filter) => filter.fieldId !== field.id);
    const built = buildFilterValue(field, operator, { value, value2, values });
    if (built === undefined) return;
    onQueryChange?.({ ...query, filters: [...other, { fieldId: field.id, operator, ...built }] });
  };
  const clearFilter = () => field && onQueryChange?.({ ...query, filters: (query.filters ?? []).filter((filter) => filter.fieldId !== field.id) });
  const operators = field ? operatorsForField(field) : [];
  return <div
    className="column-menu"
    style={{ left: x, top: y }}
    role="menu"
    aria-label={`${field?.label ?? columnLabel(column)} column menu`}
    tabIndex={-1}
    autoFocus
    onKeyDown={menuKeys(onClose)}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <header><div><strong>{field?.label ?? columnLabel(column)}</strong><small>{field?.dataType ?? "column"}{sortIndex >= 0 ? ` · sort ${sortIndex + 1}` : ""}</small></div><button aria-label="Close menu" onClick={onClose}>×</button></header>
    {field && <>
      <section><label>Sort</label><div className="column-menu-segment"><button className={sorts[sortIndex]?.direction === "asc" ? "active" : ""} onClick={() => setSort("asc")}>↑ Asc</button><button className={sorts[sortIndex]?.direction === "desc" ? "active" : ""} onClick={() => setSort("desc")}>↓ Desc</button><button onClick={() => setSort()}>Clear</button></div></section>
      <section><div className="column-menu-label"><label>Filter</label>{(query.filters?.length ?? 0) > 1 && <select aria-label="Filter logic" value={query.filterLogic ?? "and"} onChange={(event) => onQueryChange?.({ ...query, filterLogic: event.target.value as "and" | "or" })}><option value="and">Match all</option><option value="or">Match any</option></select>}</div>
        <select aria-label="Filter condition" value={operator} onChange={(event) => setOperator(event.target.value as FilterOperator)}>{operators.map((entry) => <option key={entry} value={entry}>{operatorLabel(entry, field)}</option>)}</select>
        {(operator === "isNull" || operator === "notNull") ? null
          : operator === "in" && field.options ? <select multiple aria-label="Filter values" size={Math.min(4, field.options.length)} value={[...values]} onChange={(event) => setValues(Array.from(event.target.selectedOptions, (option) => option.value))}>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : operator === "between" ? <div className="column-menu-between">
            <input aria-label="Minimum value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text"} value={value} onChange={(event) => setValue(event.target.value)} />
            <input aria-label="Maximum value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text"} value={value2} onChange={(event) => setValue2(event.target.value)} />
          </div>
          : operator === "withinLastDays" ? <input aria-label="Number of days" type="number" min={1} value={value} onChange={(event) => setValue(event.target.value)} />
          : field.options && (operator === "eq" || operator === "neq") ? <select aria-label="Filter value" value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose…</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.dataType === "boolean" ? <select aria-label="Filter value" value={value} onChange={(event) => setValue(event.target.value)}><option value="true">True</option><option value="false">False</option></select>
          : <input aria-label="Filter value" type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text"} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && applyFilter()} />}
        <div className="column-menu-actions"><button className="primary" onClick={applyFilter}>Apply</button>{existing && <button onClick={clearFilter}>Remove</button>}</div>
      </section>
    </>}
    <section className="column-menu-list"><button onClick={onAutoFit}>Auto-fit width</button>{onMove && <><button onClick={() => onMove(-1)}>Move left</button><button onClick={() => onMove(1)}>Move right</button></>}{onHide && <button onClick={onHide}>Hide column</button>}<button onClick={onFreeze}>Freeze through column</button>{onUnfreeze && <button onClick={onUnfreeze}>Unfreeze columns</button>}{onFormat && <button onClick={onFormat}>Conditional formatting…</button>}{actions?.map((action) => <button key={action.label} onClick={() => { action.onSelect({ axis: "column", index: column, fieldId: field?.id }); onClose(); }}>{action.label}</button>)}</section>
  </div>;
}
