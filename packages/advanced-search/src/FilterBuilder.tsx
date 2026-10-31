import { useEffect, useId, useImperativeHandle, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  compileToDatasetQuery,
  emptyGroup,
  emptyCondition,
  emptyRoot,
  ensureOperator,
  normaliseOperator,
  operatorShortLabel,
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

export function matchCountLabel(count: number | null | undefined): string {
  if (count === null || count === undefined) return "Apply";
  return `Show ${count.toLocaleString()} ${count === 1 ? "result" : "results"}`;
}

/**
 * COMP-04.1 — the v3 filter-builder popover: rows of field / operator / value
 * with Remove, then Add condition / Add group / Clear / Apply. A group is a row
 * that holds its own conditions and matches All of, Any of or None of them.
 * Theme variables only; no literals (COMP-01). The full-page `AdvancedSearch`
 * stays for the demo.
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
  ref,
}: FilterBuilderProps & { ref?: Ref<FilterBuilderHandle> }) {
  const [draft, setDraft] = useState<GroupNode>(() => builderTree(node));
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
    target.querySelector<HTMLElement>("select, input, button")?.focus();
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

  const ids = fields.map(fieldIdOf);
  const labelOf = useOptionLabels(fields, draft);
  const actions: RowActions = {
    fields,
    labelOf,
    ids,
    onPatch: (id, patch) => commit(patchCondition(draft, id, patch)),
    onRemove: (id) => commit(removeCondition(draft, id)),
    onRemoveGroup: (id) => commit(removeGroup(draft, id)),
    onCombinator: (id, combinator) => commit(setCombinator(draft, id, combinator)),
    onAdd: (groupId) => commit(addCondition(draft, fields[0] ?? "", groupId)),
  };

  return (
    <div ref={rootRef} className={["sb-filter-builder", className].filter(Boolean).join(" ")}>
      <div className="sb-filter-builder-rows">
        {draft.children.length === 0 && (
          <p className="sb-muted sb-filter-builder-empty">No conditions — add one to filter.</p>
        )}
        <Rows nodes={draft.children} actions={actions} />
      </div>
      <div className="sb-filter-builder-foot">
        <button
          type="button"
          className="sb-btn subtle"
          onClick={() => commit(addCondition(draft, fields[0] ?? ""))}
        >
          <Icon name="plus" />
          Add condition
        </button>
        <button
          type="button"
          className="sb-btn subtle"
          onClick={() => commit(addGroup(draft, fields[0] ?? ""))}
        >
          <Icon name="plus" />
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

type RowActions = {
  fields: readonly FilterBuilderFieldInput[];
  labelOf: (fieldId: string, value: unknown) => string;
  ids: string[];
  onPatch: (id: string, patch: Partial<ConditionNode>) => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (id: string) => void;
  onCombinator: (id: string, combinator: Combinator) => void;
  onAdd: (groupId: string) => void;
};

function Rows({ nodes, actions }: { nodes: readonly FilterNode[]; actions: RowActions }) {
  return nodes.map((child) =>
    child.type === "condition" ? (
      <BuilderRow
        key={child.id}
        node={child}
        fields={actions.fields}
        labelOf={actions.labelOf}
        ids={actions.ids}
        onPatch={(patch) => actions.onPatch(child.id, patch)}
        onRemove={() => actions.onRemove(child.id)}
      />
    ) : (
      <GroupRows key={child.id} group={child} actions={actions} />
    ),
  );
}

function GroupRows({ group, actions }: { group: GroupNode; actions: RowActions }) {
  const label = combinatorLabel(group.combinator);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own box model into the popover
    <div className="sb-filter-group" role="group" aria-label={`${label} group`} data-node-id={group.id} data-combinator={group.combinator}>
      <div className="sb-filter-group-head">
        <BuilderSelect
          ariaLabel="Match"
          value={group.combinator}
          label={label}
          onChange={(e) => actions.onCombinator(group.id, e.target.value as Combinator)}
        >
          {(Object.keys(COMBINATOR_LABELS) as Combinator[]).map((combinator) => (
            <option key={combinator} value={combinator}>
              {COMBINATOR_LABELS[combinator]}
            </option>
          ))}
        </BuilderSelect>
        <span className="sb-muted sb-filter-group-hint">the following</span>
        <span className="sb-filter-builder-spacer" />
        <button
          type="button"
          className="sb-icon-btn sb-filter-builder-remove"
          title="Remove group"
          aria-label={`Remove ${label} group`}
          onClick={() => actions.onRemoveGroup(group.id)}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="sb-filter-group-rows">
        {group.children.length === 0 && <p className="sb-muted sb-filter-builder-empty">Empty group — add a condition.</p>}
        <Rows nodes={group.children} actions={actions} />
      </div>
      <button type="button" className="sb-btn subtle sb-filter-group-add" onClick={() => actions.onAdd(group.id)}>
        <Icon name="plus" />
        Add condition
      </button>
    </div>
  );
}

/**
 * A select rendered as the v3 design's trigger: a bordered box whose label and
 * `▾` sit together, with the native `<select>` kept as a transparent overlay so
 * the control stays a real, keyboard-accessible select. The design canvas uses
 * a static `<div class="select">Status ▾</div>`; a native select would instead
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
        {label} ▾
      </span>
      <select aria-label={ariaLabel} value={value} onChange={onChange}>
        {children}
      </select>
    </span>
  );
}

/**
 * The design system's `Icon` (design-system/components/bundle.js): a 16×16
 * viewBox stroked in `currentColor` at 1.4. `Button size="sm"` renders it at
 * 12px, which is what the States canvas uses for the `plus` and `x` icons.
 */
const ICON_PATHS = {
  plus: "M8 3v10M3 8h10",
  x: "M4 4l8 8M12 4l-8 8",
} as const;

function Icon({ name, size = 12 }: { name: keyof typeof ICON_PATHS; size?: number }) {
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
  fields,
  labelOf,
  ids,
  onPatch,
  onRemove,
}: {
  node: ConditionNode;
  fields: readonly FilterBuilderFieldInput[];
  labelOf: (fieldId: string, value: unknown) => string;
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
  const remote = typed.loadOptions && (canon === "eq" || canon === "neq" || canon === "in");
  return (
    <div className={rowClass} data-node-id={node.id}>
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
        <input aria-label="Field" placeholder="field" value={node.field} onChange={(e) => onPatch({ field: e.target.value })} />
      )}
      <BuilderSelect
        ariaLabel="Operator"
        value={canon}
        label={operatorShortLabel(canon)}
        onChange={(e) => onPatch({ operator: e.target.value as FilterOperator })}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {operatorShortLabel(op)}
          </option>
        ))}
      </BuilderSelect>
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
      ) : nullary ? null : remote ? (
        <OptionPicker field={typed} labelOf={labelOf} multiple={canon === "in"} value={node.value} onChange={(value) => onPatch({ value })} />
      ) : options.length > 0 ? (
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
      ) : (
        <input
          aria-label="Value"
          placeholder={canon === "in" ? "a, b, c" : "value"}
          value={Array.isArray(node.value) ? node.value.join(", ") : String(node.value ?? "")}
          onChange={(e) => onPatch({ value: parseValueInput(e.target.value, canon) })}
        />
      )}
      <button type="button" className="sb-icon-btn sb-filter-builder-remove" title="Remove condition" aria-label="Remove condition" onClick={onRemove}>
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
    <div className="sb-filter-picker">
      {multiple && selected.length > 0 && (
        <span className="sb-filter-picker-tokens">
          {selected.map((v) => (
            <span key={v} className="chip">
              {labelOf(v)}
              <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
                ×
              </button>
            </span>
          ))}
        </span>
      )}
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
