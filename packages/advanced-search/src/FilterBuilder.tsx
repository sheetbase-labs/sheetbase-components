import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  compileToDatasetQuery,
  emptyGroup,
  emptyCondition,
  emptyRoot,
  ensureOperator,
  normaliseOperator,
  operatorLabel,
  operatorsForField,
  toDatasetQuery,
  type Combinator,
  type ConditionNode,
  type DatasetQuery,
  type FieldOption,
  type FilterNode,
  type FilterOperator,
  type GroupNode,
  type SheetbaseField,
  type SortClause,
} from "@sheetbase-labs/sheetbase-shared";
import { rememberOptions, useOptionLabels } from "./option-labels";

export type FilterBuilderFieldInput = string | SheetbaseField;

export interface FilterBuilderProps {
  /**
   * The applied filter tree the builder opens with. The root is always AND:
   * conditions and groups stay as rows, and an OR or NOT root becomes one group
   * under it.
   */
  node?: FilterNode | null;
  /** Field metadata for the field/operator/value controls. Strings are treated as text columns. */
  fields?: readonly FilterBuilderFieldInput[];
  /** The draft changed (add, edit, remove or clear). */
  onChange?: (node: GroupNode) => void;
  /** Apply pressed: the draft tree and the `DatasetQuery` it compiles to. */
  onApply?: (node: GroupNode, query: DatasetQuery) => void;
  /** Clear pressed, after the draft is emptied. */
  onClear?: () => void;
  /**
   * How many results the draft would return, from the host's server. Shown on
   * Apply as "Show 42 results"; `null` or `undefined` leaves it as "Apply".
   */
  matchCount?: number | null;
  /** Scroll to and focus this condition or group, e.g. the one a chip was clicked on. */
  focusId?: string;
  className?: string;
  /**
   * `"popover"` (default) keeps the 360px card for hosts that float the builder.
   * `"inline"` drops the card border, shadow and fixed width so it fills its
   * container, and the host decides whether that is a panel or a popover.
   */
  variant?: "popover" | "inline";
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
 * The builder's working tree: an AND root whose rows are conditions and
 * groups. An AND root is used as is; anything else (a lone condition, an OR or
 * NOT root) becomes a single row under a fresh AND root, so no meaning is lost.
 */
export function builderTree(node: FilterNode | null | undefined): GroupNode {
  if (!node) return emptyRoot();
  if (node.type === "group" && node.combinator === "AND") return node;
  return { ...emptyRoot(), children: [node] };
}

/** Rewrite the node with `id`; `null` removes it. An unknown id returns `root` itself. */
function mapNode(root: GroupNode, id: string, fn: (node: FilterNode) => FilterNode | null): GroupNode {
  let changed = false;
  function walk(node: FilterNode): FilterNode | null {
    if (node.id === id) {
      changed = true;
      return fn(node);
    }
    if (node.type === "condition") return node;
    const children: FilterNode[] = [];
    let touched = false;
    for (const child of node.children) {
      const next = walk(child);
      if (next !== child) touched = true;
      if (next) children.push(next);
    }
    return touched ? { ...node, children } : node;
  }
  const next = walk(root);
  return changed && next && next.type === "group" ? next : root;
}

function newCondition(field: FilterBuilderFieldInput): ConditionNode {
  const base = emptyCondition(fieldIdOf(field));
  return { ...base, operator: operatorsForField(asSheetbaseField(field))[0] ?? base.operator };
}

/** Append a new empty condition for `field`, its operator defaulted for the field's type. With `groupId`, it goes into that group. */
export function addCondition(root: GroupNode, field: FilterBuilderFieldInput, groupId?: string): GroupNode {
  const condition = newCondition(field);
  if (groupId === undefined || groupId === root.id) return { ...root, children: [...root.children, condition] };
  return mapNode(root, groupId, (node) =>
    node.type === "group" ? { ...node, children: [...node.children, condition] } : node,
  );
}

/** Append a group (default "Any of") holding one empty condition for `field`. */
export function addGroup(root: GroupNode, field: FilterBuilderFieldInput, combinator: Combinator = "OR"): GroupNode {
  return { ...root, children: [...root.children, { ...emptyGroup(combinator), children: [newCondition(field)] }] };
}

/** Change a group's combinator; the root stays AND. */
export function setCombinator(root: GroupNode, id: string, combinator: Combinator): GroupNode {
  if (id === root.id) return root;
  return mapNode(root, id, (node) => (node.type === "group" ? { ...node, combinator } : node));
}

/** Patch the condition with `id`, wherever it sits; a missing id leaves the tree unchanged. */
export function patchCondition(
  root: GroupNode,
  id: string,
  patch: Partial<ConditionNode>,
): GroupNode {
  return mapNode(root, id, (node) => (node.type === "condition" ? { ...node, ...patch } : node));
}

/** Remove the condition with `id`; a missing id leaves the tree unchanged. */
export function removeCondition(root: GroupNode, id: string): GroupNode {
  if (id === root.id) return root;
  return mapNode(root, id, (node) => (node.type === "condition" ? null : node));
}

/** Remove the group with `id` and everything in it; the root cannot be removed. */
export function removeGroup(root: GroupNode, id: string): GroupNode {
  if (id === root.id) return root;
  return mapNode(root, id, (node) => (node.type === "group" ? null : node));
}

/** Drop groups with nothing in them (an empty OR matches nothing, so it must not reach the query). Unchanged trees come back as the same object. */
export function pruneEmptyGroups(root: GroupNode): GroupNode {
  function walk(node: FilterNode): FilterNode | null {
    if (node.type === "condition") return node;
    const children: FilterNode[] = [];
    let touched = false;
    for (const child of node.children) {
      const next = walk(child);
      if (next !== child) touched = true;
      if (next) children.push(next);
    }
    if (children.length === 0 && node.id !== root.id) return null;
    return touched ? { ...node, children } : node;
  }
  return (walk(root) as GroupNode | null) ?? root;
}

function containsId(node: FilterNode, id: string): boolean {
  if (node.id === id) return true;
  return node.type === "group" && node.children.some((child) => containsId(child, id));
}

function findNode(node: FilterNode, id: string): FilterNode | null {
  if (node.id === id) return node;
  if (node.type === "condition") return null;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Move the condition or group `id` into the group `targetGroupId` at `index`.
 * `index` counts the target's children after the node has been taken out, so
 * reordering inside one list is "remove, then insert here". It is clamped to the
 * list. A move that would put a group inside itself, move the root or use an
 * unknown id returns `root` unchanged.
 */
export function moveNode(root: GroupNode, id: string, targetGroupId: string, index: number): GroupNode {
  if (id === root.id) return root;
  const moving = findNode(root, id);
  const target = findNode(root, targetGroupId);
  if (!moving || !target || target.type !== "group") return root;
  if (containsId(moving, targetGroupId)) return root;
  const without = mapNode(root, id, () => null);
  const insert = (node: FilterNode): FilterNode => {
    if (node.type === "condition") return node;
    if (node.id === targetGroupId) {
      const at = Math.max(0, Math.min(index, node.children.length));
      return { ...node, children: [...node.children.slice(0, at), moving, ...node.children.slice(at)] };
    }
    return { ...node, children: node.children.map(insert) };
  };
  return insert(without) as GroupNode;
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
  const pruned = pruneEmptyGroups(root);
  return compileToDatasetQuery(pruned, sort) ?? toDatasetQuery(pruned, sort);
}

function parseValueInput(raw: string, operator: FilterOperator): ConditionNode["value"] {
  if (operator === "in") return raw.split(",").map((part) => part.trim()).filter(Boolean);
  return raw;
}

const COMBINATOR_LABELS: Readonly<Record<Combinator, string>> = {
  AND: "All of",
  OR: "Any of",
  NOT: "None of",
};

/** "All of" / "Any of" / "None of" for a group's combinator. */
export function combinatorLabel(combinator: Combinator): string {
  return COMBINATOR_LABELS[combinator];
}

/** What the group's match reads as in the rail pill. */
const CONNECTOR_LABELS: Readonly<Record<Combinator, string>> = {
  AND: "And",
  OR: "Or",
  // A None of group matches when none of its rows do, which reads as "Or" on the rail.
  NOT: "Or",
};

const OPERATOR_WORDS: Readonly<Record<FilterOperator, string>> = {
  eq: "Equal to",
  neq: "Not equal to",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  contains: "Contains",
  startsWith: "Starts with",
  endsWith: "Ends with",
  in: "Any of",
  between: "Between",
  isNull: "Empty",
  notNull: "Not empty",
  withinLastDays: "Within the last days",
};

/** The operator as the rule row says it: words, never symbols ("Equal to", "Any of"). Dates read "After" / "Before". */
export function ruleOperatorLabel(operator: FilterOperator, field?: { dataType?: SheetbaseField["dataType"] }): string {
  if ((field?.dataType === "date" || field?.dataType === "datetime") && ["gt", "gte", "lt", "lte"].includes(operator)) {
    return operatorLabel(operator, field);
  }
  return OPERATOR_WORDS[operator];
}

/** "And" / "Or" for a list's connector pill. */
export function connectorLabel(combinator: Combinator): string {
  return CONNECTOR_LABELS[combinator];
}

/** What the pill's click does: And becomes Or and back. A None of group stays as it is, and so does the root. */
export function toggleCombinator(root: GroupNode, id: string): GroupNode {
  if (id === root.id) return root;
  const group = findNode(root, id);
  if (group?.type !== "group" || group.combinator === "NOT") return root;
  return setCombinator(root, id, group.combinator === "AND" ? "OR" : "AND");
}

/** "Group · 3 conditions", or "None of these · 3 conditions" for a NOT group. Counts every condition inside, nested groups included. */
export function groupSummary(group: GroupNode): { title: string; count: string } {
  const total = conditionsOf(group).length;
  return {
    title: group.combinator === "NOT" ? "None of these" : "Group",
    count: `${total} ${total === 1 ? "condition" : "conditions"}`,
  };
}

export function matchCountLabel(count: number | null | undefined): string {
  if (count === null || count === undefined) return "Apply";
  return `Show ${count.toLocaleString()} ${count === 1 ? "result" : "results"}`;
}

function locate(root: GroupNode, id: string): { parentId: string; index: number } | null {
  for (const [index, child] of root.children.entries()) {
    if (child.id === id) return { parentId: root.id, index };
    if (child.type === "group") {
      const found = locate(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The inline rule builder. Each condition is a row card (grip · field · "is" ·
 * operator · value); lists of two or more rows hang off a rail whose pill reads
 * And or Or; groups are larger cards with their own header, rail and Add
 * condition. Rows and groups drag by the grip (native HTML5 drag) or move with
 * Alt+ArrowUp / Alt+ArrowDown on it. `variant="inline"` fills its container;
 * the default `"popover"` keeps the old 360px card for hosts that float it.
 * Theme variables only (COMP-01).
 */
export function FilterBuilder({
  node,
  fields = [],
  onChange,
  onApply,
  onClear,
  matchCount,
  focusId,
  className,
  variant = "popover",
  ref,
}: FilterBuilderProps & { ref?: Ref<FilterBuilderHandle> }) {
  const [draft, setDraft] = useState<GroupNode>(() => builderTree(node));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Resync when the committed tree changes identity (e.g. an external Clear).
  useEffect(() => {
    setDraft(builderTree(node));
  }, [node]);

  useEffect(() => {
    if (!focusId) return;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(focusId)}"]`);
    if (!target) return;
    target.scrollIntoView?.({ block: "nearest" });
    target.querySelector<HTMLElement>("select, input, button:not([data-grip])")?.focus();
  }, [focusId]);

  function commit(next: GroupNode) {
    setDraft(next);
    onChange?.(next);
  }
  function handleClear() {
    commit(clearFilter());
    onClear?.();
  }
  function handleApply() {
    onApply?.(pruneEmptyGroups(draft), applyFilter(draft));
  }
  useImperativeHandle(ref, () => ({ apply: handleApply, clear: handleClear }));

  function endDrag() {
    setDragId(null);
    setDrop(null);
  }
  function finishDrop() {
    const from = dragId ? locate(draft, dragId) : null;
    if (dragId && drop && from) {
      const index = from.parentId === drop.parentId && from.index < drop.index ? drop.index - 1 : drop.index;
      commit(moveNode(draft, dragId, drop.parentId, index));
    }
    endDrag();
  }
  function canDropInto(parentId: string): boolean {
    if (!dragId) return false;
    const moving = findNode(draft, dragId);
    return !!moving && !containsId(moving, parentId);
  }

  const ids = fields.map(fieldIdOf);
  const labelOf = useOptionLabels(fields, draft);
  const actions: RowActions = {
    fields,
    labelOf,
    ids,
    dragId,
    drop,
    canDropInto,
    onDropTarget: setDrop,
    onDragStart: setDragId,
    onDragEnd: endDrag,
    onDrop: finishDrop,
    onMoveBy: (id, delta) => {
      const at = locate(draft, id);
      if (!at) return;
      const size = findNode(draft, at.parentId);
      const length = size && size.type === "group" ? size.children.length : 0;
      const index = Math.max(0, Math.min(at.index + delta, length - 1));
      if (index !== at.index) commit(moveNode(draft, id, at.parentId, index));
    },
    onPatch: (id, patch) => commit(patchCondition(draft, id, patch)),
    onRemove: (id) => commit(removeCondition(draft, id)),
    onRemoveGroup: (id) => commit(removeGroup(draft, id)),
    onCombinator: (id, combinator) => commit(setCombinator(draft, id, combinator)),
    onToggleCombinator: (id) => commit(toggleCombinator(draft, id)),
    onAdd: (groupId) => commit(addCondition(draft, fields[0] ?? "", groupId)),
  };

  return (
    <div
      ref={rootRef}
      className={["sb-filter-builder", className].filter(Boolean).join(" ")}
      data-variant={variant}
    >
      <div className="sb-fb-body">
        {draft.children.length === 0 && (
          <p className="sb-muted sb-filter-builder-empty">No conditions — add one to filter.</p>
        )}
        <List group={draft} root actions={actions} />
      </div>
      <div className="sb-filter-builder-foot">
        <button type="button" className="sb-btn sb-fb-add" onClick={() => commit(addCondition(draft, fields[0] ?? ""))}>
          <Icon name="rule" />
          Add rule
        </button>
        <button type="button" className="sb-btn sb-fb-add" onClick={() => commit(addGroup(draft, fields[0] ?? ""))}>
          <Icon name="folder" />
          Add group
        </button>
        <span className="sb-filter-builder-actions">
          <button type="button" className="sb-btn" onClick={handleClear}>
            Clear
          </button>
          <button type="button" className="sb-btn primary" onClick={handleApply} aria-live="polite">
            {matchCountLabel(matchCount)}
          </button>
        </span>
      </div>
    </div>
  );
}

type DropTarget = { parentId: string; index: number };

type RowActions = {
  fields: readonly FilterBuilderFieldInput[];
  labelOf: (fieldId: string, value: unknown) => string;
  ids: string[];
  dragId: string | null;
  drop: DropTarget | null;
  canDropInto: (parentId: string) => boolean;
  onDropTarget: (target: DropTarget | null) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMoveBy: (id: string, delta: number) => void;
  onPatch: (id: string, patch: Partial<ConditionNode>) => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (id: string) => void;
  onCombinator: (id: string, combinator: Combinator) => void;
  onToggleCombinator: (id: string) => void;
  onAdd: (groupId: string) => void;
};

/** The rows of one group, with the And / Or rail down their left when there are two or more. */
function List({ group, root = false, actions }: { group: GroupNode; root?: boolean; actions: RowActions }) {
  const rail = group.children.length >= 2;
  const label = connectorLabel(group.combinator);
  const toggles = !root && group.combinator !== "NOT";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a native drag-and-drop target; the grip button has the keyboard route
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a native drag-and-drop target; the grip button has the keyboard route
    <div
      className="sb-fb-list"
      data-rail={rail || undefined}
      onDragOver={(event) => {
        // An empty list (or the gap under the last row) takes the drop at the end.
        if (!actions.dragId || !actions.canDropInto(group.id) || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        actions.onDropTarget({ parentId: group.id, index: group.children.length });
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.onDrop();
      }}
    >
      {rail &&
        (toggles ? (
          <button
            type="button"
            className="sb-fb-pill"
            aria-label={`Match ${label === "And" ? "all" : "any"} of these. Switch to ${label === "And" ? "Or" : "And"}`}
            title={`Switch to ${label === "And" ? "Or" : "And"}`}
            onClick={() => actions.onToggleCombinator(group.id)}
          >
            {label}
          </button>
        ) : (
          <span
            className="sb-fb-pill"
            data-static
            title={root ? "Every rule must match" : "None of these may match. Change it in the group header."}
          >
            {root ? "And" : label}
          </span>
        ))}
      {group.children.length === 0 && !root && (
        <p className="sb-muted sb-filter-builder-empty" data-empty>
          Empty group — add a condition.
        </p>
      )}
      {group.children.map((child, index) => (
        <Item key={child.id} node={child} parentId={group.id} index={index} actions={actions}>
          {child.type === "condition" ? (
            <BuilderRow
              node={child}
              parentId={group.id}
              fields={actions.fields}
              labelOf={actions.labelOf}
              ids={actions.ids}
              actions={actions}
            />
          ) : (
            <GroupCard group={child} parentId={group.id} actions={actions} />
          )}
        </Item>
      ))}
    </div>
  );
}

/** One row or group in a list: the drop target that shows where a dragged item would land. */
function Item({
  node,
  parentId,
  index,
  actions,
  children,
}: {
  node: FilterNode;
  parentId: string;
  index: number;
  actions: RowActions;
  children: ReactNode;
}) {
  const edge = actions.drop && actions.drop.parentId === parentId ? (actions.drop.index === index ? "before" : actions.drop.index === index + 1 ? "after" : null) : null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a native drag-and-drop target; the grip button has the keyboard route
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a native drag-and-drop target; the grip button has the keyboard route
    <div
      className="sb-fb-item"
      data-dragging={actions.dragId === node.id || undefined}
      data-drop={edge ?? undefined}
      onDragOver={(event) => {
        if (!actions.dragId || actions.dragId === node.id || !actions.canDropInto(parentId)) return;
        event.preventDefault();
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        actions.onDropTarget({ parentId, index: after ? index + 1 : index });
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.onDrop();
      }}
    >
      {children}
    </div>
  );
}

/** The six-dot handle. Drag it, or focus it and press Alt+ArrowUp / Alt+ArrowDown. */
function Grip({ id, label, actions }: { id: string; label: string; actions: RowActions }) {
  return (
    <button
      type="button"
      data-grip
      className="sb-fb-grip"
      draggable
      aria-label={label}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title="Drag to reorder, or Alt + arrow keys"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        const item = event.currentTarget.closest(".sb-fb-item");
        if (item) event.dataTransfer.setDragImage(item, 12, 12);
        actions.onDragStart(id);
      }}
      onDragEnd={actions.onDragEnd}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        actions.onMoveBy(id, event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <Icon name="grip" size={14} />
    </button>
  );
}

function GroupCard({ group, parentId, actions }: { group: GroupNode; parentId: string; actions: RowActions }) {
  const { title, count } = groupSummary(group);
  const none = group.combinator === "NOT";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own box model into the builder
    <div className="sb-fb-group" role="group" aria-label={none ? "None of these group" : "Group"} data-node-id={group.id} data-combinator={group.combinator} data-parent-id={parentId}>
      <div className="sb-fb-group-head">
        <Grip id={group.id} label="Move group" actions={actions} />
        <span className="sb-fb-group-title">
          <strong>{title}</strong> · {count}
        </span>
        <span className="sb-filter-builder-spacer" />
        <button
          type="button"
          className="sb-fb-quiet"
          aria-pressed={none}
          title={none ? "Match any of these again" : "Match none of these"}
          onClick={() => actions.onCombinator(group.id, none ? "OR" : "NOT")}
        >
          None of these
        </button>
        <button
          type="button"
          className="sb-icon-btn sb-filter-builder-remove"
          title="Remove group"
          aria-label="Remove group"
          onClick={() => actions.onRemoveGroup(group.id)}
        >
          <Icon name="x" />
        </button>
      </div>
      <List group={group} actions={actions} />
      <button
        type="button"
        className="sb-btn sb-fb-add sb-fb-group-add"
        onClick={() => actions.onAdd(group.id)}
        onDragOver={(event) => {
          if (!actions.dragId || !actions.canDropInto(group.id)) return;
          event.preventDefault();
          event.stopPropagation();
          actions.onDropTarget({ parentId: group.id, index: group.children.length });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.onDrop();
        }}
      >
        <Icon name="condition" />
        Add condition
      </button>
    </div>
  );
}

/**
 * A select rendered as a bordered trigger: its label and a chevron sit
 * together, with the native `<select>` kept as a transparent overlay so the
 * control stays a real, keyboard-accessible select. A native select would
 * inset its label and draw its own platform chevron at the box's right edge.
 */
function BuilderSelect({
  label,
  ariaLabel,
  value,
  onChange,
  children,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  return (
    <span className="sb-filter-select">
      <span className="sb-filter-select-value" aria-hidden="true">
        {label}
      </span>
      <Icon name="chevron" size={14} />
      <select aria-label={ariaLabel} value={value} onChange={onChange}>
        {children}
      </select>
    </span>
  );
}

/**
 * The design system's `Icon`: a 16×16 viewBox stroked in `currentColor` at 1.4.
 * `grip` is filled dots rather than strokes.
 */
const ICON_PATHS = {
  plus: "M8 3v10M3 8h10",
  x: "M4 4l8 8M12 4l-8 8",
  chevron: "M4 6.5l4 4 4-4",
  // A branch: a trunk with a side line that ends in a node.
  rule: "M4.5 2.5v7.2M4.5 9.7c0-3.2 6.5-1.4 6.5-5.2M4.5 11.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 2.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  folder: "M2.5 5a1.5 1.5 0 0 1 1.5-1.5h2.3l1.4 1.5h4.3A1.5 1.5 0 0 1 13.5 6.5v5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z",
  // A bracket with two child nodes.
  condition: "M3 2.5v9.5M3 5h4.5M3 12h4.5M9 3.6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM9 10.9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z",
} as const;

const GRIP_DOTS = [
  [5.5, 3.5],
  [10.5, 3.5],
  [5.5, 8],
  [10.5, 8],
  [5.5, 12.5],
  [10.5, 12.5],
] as const;

function Icon({ name, size = 12 }: { name: keyof typeof ICON_PATHS | "grip"; size?: number }) {
  if (name === "grip") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {GRIP_DOTS.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.25} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function BuilderRow({
  node,
  parentId,
  fields,
  labelOf,
  ids,
  actions,
}: {
  node: ConditionNode;
  parentId: string;
  fields: readonly FilterBuilderFieldInput[];
  labelOf: (fieldId: string, value: unknown) => string;
  ids: string[];
  actions: RowActions;
}) {
  const onPatch = (patch: Partial<ConditionNode>) => actions.onPatch(node.id, patch);
  const selected = fields.find((field) => fieldIdOf(field) === node.field) ?? node.field;
  const typed = asSheetbaseField(selected);
  const ops = operatorsForField(typed);
  const canon = normaliseOperator(node.operator) ?? node.operator;
  const nullary = canon === "isNull" || canon === "notNull";
  const between = canon === "between";
  const options = typed.options ?? [];
  const remote = typed.loadOptions && (canon === "eq" || canon === "neq" || canon === "in");
  // "Any of" over a fixed list picks several from the same type-ahead as a remote field.
  const staticMulti = !typed.loadOptions && canon === "in" && options.length > 0;
  const pickerField = useMemo<SheetbaseField>(() => {
    if (!staticMulti) return typed;
    return {
      ...typed,
      loadOptions: async (query: string) =>
        options
          .filter((option) => option.toLowerCase().includes(query.toLowerCase()))
          .map((option) => ({ value: option, label: option })),
    };
  }, [staticMulti, typed, options]);
  return (
    <div className="sb-fb-row" data-node-id={node.id} data-parent-id={parentId}>
      <Grip id={node.id} label="Move condition" actions={actions} />
      <div className="sb-fb-row-main" data-between={between || undefined}>
        <span className="sb-fb-field">
          {fields.length > 0 ? (
            <BuilderSelect
              ariaLabel="Field"
              value={node.field}
              label={fieldLabelOf(selected) || "field…"}
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
            </BuilderSelect>
          ) : (
            <input className="sb-fb-input" aria-label="Field" placeholder="field" value={node.field} onChange={(e) => onPatch({ field: e.target.value })} />
          )}
        </span>
        <span className="sb-fb-is">is</span>
        <BuilderSelect
          ariaLabel="Operator"
          value={canon}
          label={ruleOperatorLabel(canon, typed)}
          onChange={(e) => onPatch({ operator: e.target.value as FilterOperator })}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {ruleOperatorLabel(op, typed)}
            </option>
          ))}
        </BuilderSelect>
        {between ? (
          <>
            <input
              className="sb-fb-input sb-fb-value"
              aria-label="Low value"
              type="number"
              placeholder="low"
              value={boundsOf(node.value)[0] || ""}
              onChange={(e) => onPatch({ value: [Number(e.target.value) || 0, boundsOf(node.value)[1]] })}
            />
            <input
              className="sb-fb-input sb-fb-value"
              aria-label="High value"
              type="number"
              placeholder="high"
              value={boundsOf(node.value)[1] || ""}
              onChange={(e) => onPatch({ value: [boundsOf(node.value)[0], Number(e.target.value) || 0] })}
            />
          </>
        ) : nullary ? null : remote || staticMulti ? (
          <OptionPicker field={pickerField} labelOf={labelOf} multiple={canon === "in"} value={node.value} onChange={(value) => onPatch({ value })} />
        ) : options.length > 0 ? (
          <span className="sb-fb-value">
            <BuilderSelect
              ariaLabel="Value"
              value={String(node.value ?? "")}
              label={String(node.value ?? "") || "value…"}
              onChange={(e) => onPatch({ value: e.target.value })}
            >
              <option value="">value…</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </BuilderSelect>
          </span>
        ) : (
          <input
            className="sb-fb-input sb-fb-value"
            aria-label="Value"
            placeholder={canon === "in" ? "a, b, c" : "value"}
            value={Array.isArray(node.value) ? node.value.join(", ") : String(node.value ?? "")}
            onChange={(e) => onPatch({ value: parseValueInput(e.target.value, canon) })}
          />
        )}
      </div>
      <button type="button" className="sb-icon-btn sb-filter-builder-remove" title="Remove condition" aria-label="Remove condition" onClick={() => actions.onRemove(node.id)}>
        <Icon name="x" />
      </button>
    </div>
  );
}

const PICKER_DELAY_MS = 200;

/**
 * Type-ahead value editor for fields with `loadOptions`: an ARIA combobox that
 * asks the host for options as the person types (debounced, stale answers
 * dropped) and keeps the chosen labels so chips can show them. Single choice
 * for equals / does not equal, several for "any of".
 */
function OptionPicker({
  field,
  labelOf: resolveLabel,
  multiple,
  value,
  onChange,
}: {
  field: SheetbaseField;
  labelOf: (fieldId: string, value: unknown) => string;
  multiple: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<readonly FieldOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const request = useRef(0);
  const selected: string[] = (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]).map(String);
  const labelOf = (v: string) => resolveLabel(field.id, v);

  useEffect(() => {
    if (!open || !field.loadOptions) return;
    const load = field.loadOptions;
    const mine = ++request.current;
    setLoading(true);
    const timer = setTimeout(() => {
      load(query)
        .then((found) => {
          if (request.current !== mine) return;
          rememberOptions(field, found);
          setOptions(found);
          setActive(0);
          setLoading(false);
        })
        .catch(() => {
          if (request.current !== mine) return;
          setOptions([]);
          setLoading(false);
        });
    }, query === "" ? 0 : PICKER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, query, field]);

  function choose(option: FieldOption) {
    rememberOptions(field, [option]);
    if (multiple) {
      onChange(selected.includes(option.value) ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
      setQuery("");
    } else {
      onChange(option.value);
      setQuery("");
      setOpen(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Backspace" && multiple && query === "" && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  }

  const shown = open ? query : multiple ? "" : selected[0] ? labelOf(selected[0]) : "";
  return (
    <div className="sb-filter-picker sb-fb-value">
      {multiple &&
        selected.map((v) => (
          <span key={v} className="chip">
            {labelOf(v)}
            <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
      <input
        role="combobox"
        aria-label="Value"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={multiple && selected.length > 0 ? "add…" : "search…"}
        value={shown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div id={listId} role="listbox" aria-label={`${field.label} options`} aria-multiselectable={multiple || undefined} className="sb-filter-picker-list">
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selected.includes(option.value)}
              data-active={index === active || undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
            >
              {option.label}
            </div>
          ))}
          {options.length === 0 && (
            <div className="sb-muted sb-filter-picker-note">{loading ? "Searching…" : "No matches"}</div>
          )}
        </div>
      )}
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
