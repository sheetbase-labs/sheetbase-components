import {
  operatorShortLabel,
  type ConditionNode,
  type FilterNode,
  type FilterOperator,
  type SheetbaseField,
} from "@sheetbase-labs/sheetbase-shared";

export type FilterChipsFieldInput = string | SheetbaseField;

export interface FilterChipsProps {
  /** The applied filter tree. Chips are one per condition, in order. */
  node: FilterNode | null | undefined;
  /** Field metadata, so chips show the field's label instead of its id. */
  fields?: readonly FilterChipsFieldInput[];
  /** Remove the condition with this id. */
  onRemove?: (conditionId: string) => void;
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

function formatValue(operator: FilterOperator, value: unknown): string {
  if (operator === "isNull" || operator === "notNull") return "";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((item) => String(item)).join("–");
  if (value === "") return "—";
  return String(value);
}

/**
 * Human phrase for one condition, e.g. `Status is In progress`. The remove
 * button carries the same phrase so screen readers announce what is removed.
 */
export function describeCondition(
  condition: ConditionNode,
  fields: readonly FilterChipsFieldInput[] = [],
): string {
  const field = fields.find((candidate) => fieldIdOf(candidate) === condition.field);
  const name = field ? fieldLabelOf(field) : condition.field || "Field";
  const operator = operatorShortLabel(condition.operator as FilterOperator);
  const value = formatValue(condition.operator as FilterOperator, condition.value);
  // The short operator label already includes "is"/"isn't" etc.
  return value ? `${name} ${operator} ${value}` : `${name} ${operator}`;
}

function flattenConditions(
  node: FilterNode | null | undefined,
  out: ConditionNode[] = [],
): ConditionNode[] {
  if (!node) return out;
  if (node.type === "condition") {
    out.push(node);
    return out;
  }
  for (const child of node.children) flattenConditions(child, out);
  return out;
}

/**
 * COMP-04.2 — the applied-filter chip row: one chip per condition with a named
 * remove label, followed by "+ Add filter". One row, above the table it filters
 * (ChipTag README).
 */
export function FilterChips({
  node,
  fields = [],
  onRemove,
  onAdd,
  addLabel = "+ Add filter",
  className,
}: FilterChipsProps) {
  const conditions = flattenConditions(node);
  if (conditions.length === 0 && !onAdd) return null;
  return (
    <div className={["sb-chips", className].filter(Boolean).join(" ")}>
      {conditions.map((condition) => {
        const label = describeCondition(condition, fields);
        return (
          <span key={condition.id} className="chip">
            {label}
            {onRemove ? (
              <button
                type="button"
                aria-label={`Remove filter: ${label}`}
                onClick={() => onRemove(condition.id)}
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}
      {onAdd ? (
        <button type="button" className="sb-chip-add" onClick={onAdd}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
