import {
  operatorShortLabel,
  type Combinator,
  type ConditionNode,
  type FilterNode,
  type FilterOperator,
  type SheetbaseField,
} from "@sheetbase-labs/sheetbase-shared";
import { useOptionLabels } from "./option-labels";

export type FilterChipsFieldInput = string | SheetbaseField;

export interface FilterChipsProps {
  /** The applied filter tree. Chips are one per condition or group directly under the root, in order. */
  node: FilterNode | null | undefined;
  /** Field metadata, so chips show the field's label instead of its id. */
  fields?: readonly FilterChipsFieldInput[];
  /** Remove the condition or group with this id. A group goes as a unit. */
  onRemove?: (nodeId: string) => void;
  /** A chip was clicked: open the filter builder at this condition or group. */
  onEdit?: (nodeId: string) => void;
  /** Show the trailing "+ Add filter" button that opens the filter builder. */
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
}

function fieldIdOf(field: FilterChipsFieldInput): string {
  return typeof field === "string" ? field : field.id;
}

function fieldLabelOf(field: FilterChipsFieldInput): string {
  return typeof field === "string" ? field : field.label;
}

function formatValue(operator: FilterOperator, value: unknown, label: (value: unknown) => string = String): string {
  if (operator === "isNull" || operator === "notNull") return "";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(label).join(operator === "between" ? "–" : ", ");
  if (value === "") return "—";
  return label(value);
}

/**
 * Human phrase for one condition, e.g. `Status is In progress`. The remove
 * button carries the same phrase so screen readers announce what is removed.
 * `labelOf` swaps a stored value for its display label (see `useOptionLabels`).
 */
export function describeCondition(
  condition: ConditionNode,
  fields: readonly FilterChipsFieldInput[] = [],
  labelOf?: (fieldId: string, value: unknown) => string,
): string {
  const field = fields.find((candidate) => fieldIdOf(candidate) === condition.field);
  const name = field ? fieldLabelOf(field) : condition.field || "Field";
  const operator = operatorShortLabel(condition.operator as FilterOperator);
  const value = formatValue(condition.operator as FilterOperator, condition.value, (v) => labelOf?.(condition.field, v) ?? String(v));
  // The short operator label already includes "is"/"isn't" etc.
  return value ? `${name} ${operator} ${value}` : `${name} ${operator}`;
}

const GROUP_LEAD: Readonly<Record<Combinator, string>> = { AND: "All of", OR: "Any of", NOT: "None of" };

/** Human phrase for a group, e.g. `None of: Project is AAV8 TFF`. Empty groups have no phrase. */
export function describeNode(
  node: FilterNode,
  fields: readonly FilterChipsFieldInput[] = [],
  labelOf?: (fieldId: string, value: unknown) => string,
): string {
  if (node.type === "condition") return describeCondition(node, fields, labelOf);
  const parts = node.children.map((child) => {
    const part = describeNode(child, fields, labelOf);
    return child.type === "group" && part ? `(${part})` : part;
  }).filter(Boolean);
  return parts.length ? `${GROUP_LEAD[node.combinator]}: ${parts.join(" · ")}` : "";
}

/** The chips for a tree: an AND root's rows, otherwise the root as one chip. */
function chipNodes(node: FilterNode | null | undefined): FilterNode[] {
  if (!node) return [];
  if (node.type === "group" && node.combinator === "AND") return [...node.children];
  return [node];
}

/**
 * COMP-04.2 — the applied-filter chip row: one chip per condition or group with
 * a named remove label, followed by "+ Add filter". One row, above the table it
 * filters (ChipTag README). A group is one chip, removed as a unit; with `onEdit`
 * the chip text is a button that opens the builder at it.
 */
export function FilterChips({
  node,
  fields = [],
  onRemove,
  onEdit,
  onAdd,
  addLabel = "+ Add filter",
  className,
}: FilterChipsProps) {
  const labelOf = useOptionLabels(fields, node);
  const chips = chipNodes(node)
    .map((child) => ({ child, label: describeNode(child, fields, labelOf) }))
    .filter((chip) => chip.label !== "");
  if (chips.length === 0 && !onAdd) return null;
  return (
    <div className={["sb-chips", className].filter(Boolean).join(" ")}>
      {chips.map(({ child, label }) => (
        <span key={child.id} className={child.type === "group" ? "chip sb-chip-group" : "chip"} data-node-id={child.id}>
          {onEdit ? (
            <button type="button" className="sb-chip-label" aria-label={`Edit filter: ${label}`} onClick={() => onEdit(child.id)}>
              {label}
            </button>
          ) : (
            label
          )}
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove filter: ${label}`}
              onClick={() => onRemove(child.id)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {onAdd ? (
        <button type="button" className="sb-chip-add" onClick={onAdd}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
