import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import {
  compileToDatasetQuery,
  emptyCondition,
  emptyRoot,
  ensureOperator,
  normaliseOperator,
  operatorShortLabel,
  operatorsForField,
  toDatasetQuery,
  type ConditionNode,
  type DatasetQuery,
  type FilterNode,
  type FilterOperator,
  type GroupNode,
  type SheetbaseField,
  type SortClause,
} from "@sheetbase-labs/sheetbase-shared";

export type FilterBuilderFieldInput = string | SheetbaseField;

export interface FilterBuilderProps {
  /** The applied filter tree the builder opens with. Conditions are read from it (any nesting is flattened into an AND root). */
  node?: FilterNode | null;
  /** Field metadata for the field/operator/value controls. Strings are treated as text columns. */
  fields?: readonly FilterBuilderFieldInput[];
  /** The draft changed (add, edit, remove or clear). */
  onChange?: (node: GroupNode) => void;
  /** Apply pressed: the draft tree and the `DatasetQuery` it compiles to. */
  onApply?: (node: GroupNode, query: DatasetQuery) => void;
  /** Clear pressed, after the draft is emptied. */
  onClear?: () => void;
  className?: string;
}

export interface FilterBuilderHandle {
  /** Commit the current draft, as the Apply button does. */
  apply(): void;
  /** Empty the draft, as the Clear button does. */
  clear(): void;
}

function fieldIdOf(field: FilterBuilderFieldInput): string {
  return typeof field === "string" ? field : field.id;
}

function fieldLabelOf(field: FilterBuilderFieldInput): string {
  return typeof field === "string" ? field : field.label;
}

function asSheetbaseField(field: FilterBuilderFieldInput): SheetbaseField {
  if (typeof field !== "string") return field;
  return { id: field, label: field, dataType: "text" };
}

/** Flatten any filter tree to its conditions in order. */
export function conditionsOf(node: FilterNode | null | undefined): ConditionNode[] {
  const out: ConditionNode[] = [];
  function walk(current: FilterNode) {
    if (current.type === "condition") {
      out.push(current);
      return;
    }
    for (const child of current.children) walk(child);
  }
  if (node) walk(node);
  return out;
}

/**
 * The builder's working tree: one AND root over the node's conditions. A
 * non-AND root keeps its id but is rewritten as AND, so the builder's rows are
 * exactly the conditions it can edit.
 */
export function builderTree(node: FilterNode | null | undefined): GroupNode {
  const conditions = conditionsOf(node);
  const root = node && node.type === "group" ? node : emptyRoot();
  return { ...root, combinator: "AND", children: conditions };
}

/** Append a new empty condition for `field`, its operator defaulted for the field's type. */
export function addCondition(root: GroupNode, field: FilterBuilderFieldInput): GroupNode {
  const typed = asSheetbaseField(field);
  const base = emptyCondition(fieldIdOf(field));
  const condition: ConditionNode = { ...base, operator: operatorsForField(typed)[0] ?? base.operator };
  return { ...root, children: [...root.children, condition] };
}

/** Patch the condition with `id`; a missing id leaves the tree unchanged. */
export function patchCondition(
  root: GroupNode,
  id: string,
  patch: Partial<ConditionNode>,
): GroupNode {
  let found = false;
  const children = root.children.map((child) => {
    if (child.type !== "condition" || child.id !== id) return child;
    found = true;
    return { ...child, ...patch };
  });
  return found ? { ...root, children } : root;
}

/** Remove the condition with `id`; a missing id leaves the tree unchanged. */
export function removeCondition(root: GroupNode, id: string): GroupNode {
  const children = root.children.filter((child) => child.type !== "condition" || child.id !== id);
  return children.length === root.children.length ? root : { ...root, children };
}

/** An empty AND root — what Clear leaves behind. */
export function clearFilter(): GroupNode {
  return emptyRoot();
}

/**
 * The query Apply emits: flat `filters`/`filterLogic` when the tree flattens
 * losslessly (`compileToDatasetQuery`), `filterTree` otherwise. Never
 * undefined, so clearing can never silently drop a downstream filter.
 */
export function applyFilter(root: GroupNode, sort?: SortClause[]): DatasetQuery {
  return compileToDatasetQuery(root, sort) ?? toDatasetQuery(root, sort);
}

function parseValueInput(raw: string, operator: FilterOperator): ConditionNode["value"] {
  if (operator === "in") return raw.split(",").map((part) => part.trim()).filter(Boolean);
  return raw;
}

/**
 * COMP-04.1 — the v3 filter-builder popover: rows of field / operator / value
 * with Remove, then Add condition / Clear / Apply. Theme variables only; no
 * literals (COMP-01). The full-page `AdvancedSearch` stays for the demo.
 */
export function FilterBuilder({
  node,
  fields = [],
  onChange,
  onApply,
  onClear,
  className,
  ref,
}: FilterBuilderProps & { ref?: Ref<FilterBuilderHandle> }) {
  const [draft, setDraft] = useState<GroupNode>(() => builderTree(node));

  // Resync when the committed tree changes identity (e.g. an external Clear).
  useEffect(() => {
    setDraft(builderTree(node));
  }, [node]);

  function commit(next: GroupNode) {
    setDraft(next);
    onChange?.(next);
  }
  function handleClear() {
    commit(clearFilter());
    onClear?.();
  }
  function handleApply() {
    onApply?.(draft, applyFilter(draft));
  }
  useImperativeHandle(ref, () => ({ apply: handleApply, clear: handleClear }));

  const ids = fields.map(fieldIdOf);

  return (
    <div className={["sb-filter-builder", className].filter(Boolean).join(" ")}>
      <div className="sb-filter-builder-rows">
        {draft.children.length === 0 && (
          <p className="sb-muted sb-filter-builder-empty">No conditions — add one to filter.</p>
        )}
        {draft.children.map((child) =>
          child.type === "condition" ? (
            <BuilderRow
              key={child.id}
              node={child}
              fields={fields}
              ids={ids}
              onPatch={(patch) => commit(patchCondition(draft, child.id, patch))}
              onRemove={() => commit(removeCondition(draft, child.id))}
            />
          ) : null,
        )}
      </div>
      <div className="sb-filter-builder-foot">
        <button
          type="button"
          className="sb-btn subtle"
          onClick={() => commit(addCondition(draft, fields[0] ?? ""))}
        >
          <span aria-hidden="true">+</span> Add condition
        </button>
        <span className="sb-filter-builder-spacer" />
        <button type="button" className="sb-btn" onClick={handleClear}>
          Clear
        </button>
        <button type="button" className="sb-btn primary" onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function BuilderRow({
  node,
  fields,
  ids,
  onPatch,
  onRemove,
}: {
  node: ConditionNode;
  fields: readonly FilterBuilderFieldInput[];
  ids: string[];
  onPatch: (patch: Partial<ConditionNode>) => void;
  onRemove: () => void;
}) {
  const selected = fields.find((field) => fieldIdOf(field) === node.field) ?? node.field;
  const typed = asSheetbaseField(selected);
  const ops = operatorsForField(typed);
  const canon = normaliseOperator(node.operator) ?? node.operator;
  const nullary = canon === "isNull" || canon === "notNull";
  const between = canon === "between";
  const options = typed.options ?? [];
  const rowClass = between
    ? "sb-filter-builder-row between"
    : "sb-filter-builder-row";
  return (
    <div className={rowClass}>
      {fields.length > 0 ? (
        <select
          aria-label="Field"
          value={node.field}
          onChange={(e) => {
            const next = fields.find((field) => fieldIdOf(field) === e.target.value) ?? e.target.value;
            onPatch({ field: e.target.value, operator: ensureOperator(asSheetbaseField(next), canon) });
          }}
        >
          {!ids.includes(node.field) && <option value={node.field}>{node.field || "field…"}</option>}
          {fields.map((field) => (
            <option key={fieldIdOf(field)} value={fieldIdOf(field)}>
              {fieldLabelOf(field)}
            </option>
          ))}
        </select>
      ) : (
        <input aria-label="Field" placeholder="field" value={node.field} onChange={(e) => onPatch({ field: e.target.value })} />
      )}
      <select aria-label="Operator" value={canon} onChange={(e) => onPatch({ operator: e.target.value as FilterOperator })}>
        {ops.map((op) => (
          <option key={op} value={op}>
            {operatorShortLabel(op)}
          </option>
        ))}
      </select>
      {between ? (
        <>
          <input
            aria-label="Low value"
            type="number"
            placeholder="low"
            value={boundsOf(node.value)[0] || ""}
            onChange={(e) => onPatch({ value: [Number(e.target.value) || 0, boundsOf(node.value)[1]] })}
          />
          <input
            aria-label="High value"
            type="number"
            placeholder="high"
            value={boundsOf(node.value)[1] || ""}
            onChange={(e) => onPatch({ value: [boundsOf(node.value)[0], Number(e.target.value) || 0] })}
          />
        </>
      ) : nullary ? null : options.length > 0 ? (
        <select
          aria-label="Value"
          value={String(node.value ?? "")}
          onChange={(e) => onPatch({ value: e.target.value })}
        >
          <option value="">value…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Value"
          placeholder={canon === "in" ? "a, b, c" : "value"}
          value={Array.isArray(node.value) ? node.value.join(", ") : String(node.value ?? "")}
          onChange={(e) => onPatch({ value: parseValueInput(e.target.value, canon) })}
        />
      )}
      <button type="button" className="sb-icon-btn sb-filter-builder-remove" title="Remove condition" aria-label="Remove condition" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

function boundsOf(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]) || 0, Number(value[1]) || 0];
  if (value && typeof value === "object" && "low" in value && "high" in value) {
    const range = value as { low: unknown; high: unknown };
    return [Number(range.low) || 0, Number(range.high) || 0];
  }
  return [0, 0];
}
