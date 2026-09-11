import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import {
  ThemeToggleButton,
  PaneLayout,
  compileToDatasetQuery,
  countNodes,
  describeFilter,
  emptyCondition,
  emptyRoot,
  ensureOperator,
  groupRows,
  normaliseOperator,
  operatorShortLabel,
  operatorsForField,
  queryKey,
  toDatasetQuery,
  usePersistedTheme,
  type Combinator,
  type ConditionNode,
  type DatasetQuery,
  type FilterNode,
  type FilterOperator,
  type GroupNode,
  type Layout,
  type PaneSpec,
  type SearchSpec,
  type SheetbaseField,
  type ThemeMode,
  loadInitialState,
  useIdleSave,
  type PersistenceAdapter,
} from "sheetbase-shared";
import { DataGrid } from "sheetbase-table";
import { applySearch } from "./predicate";
import type { SearchOperator, SearchRow } from "./types";

export type SearchFieldInput = string | SheetbaseField;

export interface AdvancedSearchHandle {
  /** Reset the filter tree, as the topbar Clear button does. */
  clear(): void;
}

export interface AdvancedSearchProps {
  value?: SearchSpec;
  initialSpec?: SearchSpec;
  onChange?: (next: SearchSpec) => void;
  /** Candidate fields for condition editors. Strings are treated as text columns. */
  fields?: readonly SearchFieldInput[];
  /** Optional dataset — enables live match counts + table preview. */
  rows?: SearchRow[];
  /** Controlled theme. Omit for uncontrolled (toggle manages it). */
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
  /** Fired with the compiled query: flat filters when the tree flattens losslessly, `filterTree` otherwise. Always a DatasetQuery — a nested spec never means "clear". */
  onDatasetQueryChange?: (query: DatasetQuery) => void;
  persistKey?: string;
  adapter?: PersistenceAdapter<SearchSpec>;
  /** Omit the component topbar so a host can own pane chrome. Default `"full"`. */
  chrome?: "full" | "none";
  /** Controlled preview-pane visibility. Omit for internal state (default shown). */
  preview?: boolean;
  onPreviewChange?(next: boolean): void;
  /** Imperative actions for hosts that render pane chrome. */
  ref?: Ref<AdvancedSearchHandle>;
}

function fieldIdOf(field: SearchFieldInput): string {
  return typeof field === "string" ? field : field.id;
}

function fieldLabelOf(field: SearchFieldInput): string {
  return typeof field === "string" ? field : field.label;
}

function asSheetbaseField(field: SearchFieldInput): SheetbaseField {
  if (typeof field !== "string") return field;
  return { id: field, label: field, dataType: "text" };
}

function fieldIds(fields: readonly SearchFieldInput[]): string[] {
  return fields.map(fieldIdOf);
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Filter tree | preview, each a pane. */
const SEARCH_PANE_LAYOUT: Layout = {
  kind: "split",
  id: "search-root",
  direction: "row",
  sizes: [0.48, 0.52],
  children: [
    { kind: "stack", id: "search-filter", panes: ["filter"], active: "filter" },
    { kind: "stack", id: "search-preview", panes: ["preview"], active: "preview" },
  ],
};

/** Just the filter pane, for when the preview is toggled off. */
const SEARCH_FILTER_ONLY_LAYOUT: Layout = {
  kind: "stack",
  id: "search-filter-only",
  panes: ["filter"],
  active: "filter",
};

function updateNode(root: GroupNode, id: string, fn: (node: FilterNode) => FilterNode | null): GroupNode {
  function walk(node: FilterNode): FilterNode | null {
    if (node.id === id) return fn(node);
    if (node.type === "group") {
      const children: FilterNode[] = [];
      for (const child of node.children) {
        const next = walk(child);
        if (next) children.push(next);
      }
      return { ...node, children };
    }
    return node;
  }
  const next = walk(root);
  if (!next || next.type !== "group") return root;
  return next;
}

/** Column order + display types, explorer-style (`field` + right-aligned type).
 * Preview behaviour matches the shared applySearch pipeline. */
function previewColumns(matches: SearchRow[], fields: string[]): Array<{ key: string; kind: string }> {
  const keys: string[] = [];
  for (const row of matches) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  const ordered = [...fields.filter((f) => keys.includes(f)), ...keys.filter((k) => !fields.includes(k))].slice(0, 8);
  return ordered.map((key) => ({ key, kind: kindOf(matches, key) }));
}

function kindOf(rows: SearchRow[], key: string): string {
  for (const row of rows) {
    const v = row[key];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    return "string";
  }
  return "string";
}

function boundsOf(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]) || 0, Number(value[1]) || 0];
  if (value && typeof value === "object" && "low" in value && "high" in value) {
    const v = value as { low: unknown; high: unknown };
    return [Number(v.low) || 0, Number(v.high) || 0];
  }
  return [0, 0];
}

function GroupEditor({ node, depth, fields, onPatch }: {
  node: GroupNode;
  depth: number;
  fields: readonly SearchFieldInput[];
  onPatch: (id: string, fn: (node: FilterNode) => FilterNode | null) => void;
}) {
  return (
    <div className="sb-group" style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div className="sb-group-bar">
        <div className="sb-segmented" role="group" aria-label="Group combinator">
          {(["AND", "OR", "NOT"] as Combinator[]).map((c) => (
            <button key={c} className={node.combinator === c ? "active" : ""} onClick={() => onPatch(node.id, (n) => (n.type === "group" ? { ...n, combinator: c } : n))}>{c}</button>
          ))}
        </div>
        <span className="sb-muted">{node.combinator === "NOT" ? "matches rows where none of the children match" : node.combinator === "OR" ? "any child matches" : "every child matches"}</span>
        <span className="sb-group-btns">
          <button className="sb-link-btn" onClick={() => onPatch(node.id, (n) => (n.type === "group" ? { ...n, children: [...n.children, { ...emptyCondition(fieldIdOf(fields[0] ?? "")), id: uid("cnd") }] } : n))}>+ Condition</button>
          <button className="sb-link-btn" onClick={() => onPatch(node.id, (n) => (n.type === "group" ? { ...n, children: [...n.children, { type: "group", id: uid("grp"), combinator: "AND", children: [] }] } : n))}>+ Group</button>
          {depth > 0 && <button className="sb-remove" title="Remove group" onClick={() => onPatch(node.id, () => null)}>×</button>}
        </span>
      </div>
      <div className="sb-group-children">
        {node.children.length === 0 && <p className="sb-muted" style={{ padding: "4px 2px" }}>Empty group matches everything — add a condition.</p>}
        {node.children.map((child) =>
          child.type === "group" ? (
            <GroupEditor key={child.id} node={child} depth={depth + 1} fields={fields} onPatch={onPatch} />
          ) : (
            <ConditionRow key={child.id} node={child} fields={fields} onPatch={onPatch} />
          ),
        )}
      </div>
    </div>
  );
}

function ConditionRow({ node, fields, onPatch }: {
  node: ConditionNode;
  fields: readonly SearchFieldInput[];
  onPatch: (id: string, fn: (node: FilterNode) => FilterNode | null) => void;
}) {
  function patch(next: Partial<ConditionNode>) {
    onPatch(node.id, (n) => (n.type === "condition" ? { ...n, ...next } : n));
  }
  const selected = fields.find((field) => fieldIdOf(field) === node.field) ?? node.field;
  const typed = asSheetbaseField(selected);
  const ops = operatorsForField(typed);
  const canon = normaliseOperator(node.operator) ?? node.operator;
  const empty = canon === "isNull" || canon === "notNull";
  const [low, high] = boundsOf(node.value);
  const ids = fieldIds(fields);
  return (
    <div className={canon === "between" ? "sb-filter-rule between" : "sb-filter-rule"}>
      {fields.length > 0 ? (
        <select aria-label="Field" value={node.field} onChange={(e) => {
          // Re-point the operator when the new field doesn't accept it.
          const next = fields.find((field) => fieldIdOf(field) === e.target.value) ?? e.target.value;
          patch({ field: e.target.value, operator: ensureOperator(asSheetbaseField(next), canon) });
        }}>
          {!ids.includes(node.field) && <option value={node.field}>{node.field || "field…"}</option>}
          {fields.map((f) => <option key={fieldIdOf(f)} value={fieldIdOf(f)}>{fieldLabelOf(f)}</option>)}
        </select>
      ) : (
        <input aria-label="Field" placeholder="field" value={node.field} onChange={(e) => patch({ field: e.target.value })} />
      )}
      <select aria-label="Operator" value={canon} onChange={(e) => patch({ operator: e.target.value as SearchOperator })}>
        {ops.map((op) => <option key={op} value={op}>{operatorShortLabel(op)}</option>)}
      </select>
      {canon === "between" ? (
        <>
          <input aria-label="Low value" type="number" placeholder="low" value={low || ""} onChange={(e) => patch({ value: [Number(e.target.value) || 0, high] })} />
          <input aria-label="High value" type="number" placeholder="high" value={high || ""} onChange={(e) => patch({ value: [low, Number(e.target.value) || 0] })} />
        </>
      ) : !empty && (
        <input
          aria-label="Value"
          placeholder={canon === "in" ? "a, b, c" : "value"}
          value={Array.isArray(node.value) ? node.value.join(", ") : String(node.value ?? "")}
          onChange={(e) => patch({ value: parseValueInput(e.target.value, canon) })}
        />
      )}
      <button className="sb-remove" title="Remove condition" onClick={() => onPatch(node.id, () => null)}>×</button>
    </div>
  );
}

function parseValueInput(raw: string, operator: FilterOperator): ConditionNode["value"] {
  if (operator === "in") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}

function PreviewTable({ rows, fields, cap }: { rows: SearchRow[]; fields: string[]; cap?: number }) {
  const columns = previewColumns(rows, fields);
  if (columns.length === 0) return <p className="sb-muted" style={{ padding: 14 }}>No columns.</p>;
  return (
    <DataGrid
      columns={columns.map((column) => ({ id: column.key, label: column.key, kind: column.kind }))}
      rows={cap ? rows.slice(0, cap) : rows}
      emptyMessage="No matches."
    />
  );
}

export function AdvancedSearch({ value, initialSpec, onChange, fields = [], rows = [], theme, defaultTheme = "light", onThemeChange, onDatasetQueryChange, persistKey, adapter, chrome = "full", preview, onPreviewChange, ref }: AdvancedSearchProps) {
  const [draft, setDraft] = useState<SearchSpec>(() => loadInitialState(persistKey, adapter, initialSpec ?? { filter: emptyRoot() }));
  const spec = value ?? draft;
  useIdleSave(persistKey, spec, adapter);
  const { activeTheme, toggleTheme } = usePersistedTheme({ theme, defaultTheme, onThemeChange });
  const [innerPreview, setInnerPreview] = useState(true);
  const showPreview = preview ?? innerPreview;
  function togglePreview() {
    const next = !showPreview;
    if (preview === undefined) setInnerPreview(next);
    onPreviewChange?.(next);
  }

  function commit(next: SearchSpec) {
    if (value === undefined) setDraft(next);
    onChange?.(next);
  }
  function patchFilter(id: string, fn: (node: FilterNode) => FilterNode | null) {
    commit({ ...spec, filter: updateNode(spec.filter, id, fn) });
  }
  function clear() {
    commit({ filter: emptyRoot() });
  }
  useImperativeHandle(ref, () => ({ clear }));

  const matches = useMemo(() => (rows.length > 0 ? applySearch(rows, spec) : null), [rows, spec]);
  const nodes = countNodes(spec.filter);
  const sortClauses = spec.sort ? [{ fieldId: spec.sort.field, direction: spec.sort.direction }] : undefined;
  const flattened = compileToDatasetQuery(spec.filter, sortClauses);
  const compiled = flattened ?? toDatasetQuery(spec.filter, sortClauses);
  const ids = fieldIds(fields);
  const compiledKey = queryKey(compiled);

  useEffect(() => {
    onDatasetQueryChange?.(compiled);
    // compiled is a fresh object each render; key on its stable content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledKey, onDatasetQueryChange]);

  return (
    <div className="sheetbase-scope sb-search" data-theme={activeTheme}>
      <div className={chrome === "none" ? "sb-frame no-topbar" : "sb-frame"}>
        {chrome !== "none" && (
          <div className="sb-topbar">
            <div className="sb-toolbar-group">
              {matches && <span className="sb-stat">{matches.length} / {rows.length} match</span>}
              <span className="sb-stat" title={describeFilter(spec.filter)}>{nodes.conditions} conditions · {nodes.groups} groups{flattened ? " · flat query" : " · tree query"}</span>
            </div>
            <div className="sb-topbar-actions">
              {theme === undefined && <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />}
              <button className={showPreview ? "sb-btn" : "sb-btn subtle"} aria-pressed={showPreview} onClick={togglePreview}>Preview</button>
              <button className="sb-btn" onClick={clear}>Clear</button>
            </div>
          </div>
        )}
        <PaneLayout
          key={showPreview ? "with-preview" : "filter-only"}
          className="sb-panes--fit"
          defaultLayout={showPreview ? SEARCH_PANE_LAYOUT : SEARCH_FILTER_ONLY_LAYOUT}
          panes={[
            {
              id: "filter",
              title: "Filter tree",
              dragHandle: "heading",
              content: (
                <section className="sb-search-main sb-plate">
            <div className="sb-panel-heading"><span>Filter tree</span></div>
            <div className="sb-search-scroll">
              <GroupEditor node={spec.filter} depth={0} fields={fields} onPatch={patchFilter} />
              <div className="sb-search-controls">
                <label className="sb-compact"><span>Group by</span>
                  <select className="sb-select" value={spec.groupBy ?? ""} onChange={(e) => commit({ ...spec, groupBy: e.target.value || undefined })}>
                    <option value="">No grouping</option>
                    {fields.map((f) => <option key={fieldIdOf(f)} value={fieldIdOf(f)}>{fieldLabelOf(f)}</option>)}
                  </select>
                </label>
                <label className="sb-compact"><span>Sort</span>
                  <select className="sb-select" value={spec.sort?.field ?? ""} onChange={(e) => commit({ ...spec, sort: e.target.value ? { field: e.target.value, direction: spec.sort?.direction ?? "asc" } : undefined })}>
                    <option value="">Unsorted</option>
                    {fields.map((f) => <option key={fieldIdOf(f)} value={fieldIdOf(f)}>{fieldLabelOf(f)}</option>)}
                  </select>
                </label>
                {spec.sort && (
                  <label className="sb-compact"><span>Direction</span>
                    <select className="sb-select" value={spec.sort.direction} onChange={(e) => commit({ ...spec, sort: { field: spec.sort!.field, direction: e.target.value as "asc" | "desc" } })}>
                      <option value="asc">Ascending</option><option value="desc">Descending</option>
                    </select>
                  </label>
                )}
                <label className="sb-compact"><span>Limit</span>
                  <input className="sb-input" type="number" min={0} placeholder="all" value={spec.limit ?? ""} onChange={(e) => commit({ ...spec, limit: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} />
                </label>
              </div>
            </div>
                </section>
              ),
            },
            ...(showPreview ? [{
              id: "preview",
              title: "Preview",
              dragHandle: false,
              content: (
                <aside className="sb-search-side sb-plate">
                  {!matches ? (
                    <p className="sb-muted" style={{ padding: 14 }}>Pass <code>rows</code> to preview matches live.</p>
                  ) : spec.groupBy ? (
                    <GroupedPreview matches={matches} fields={ids} groupBy={spec.groupBy} />
                  ) : (
                    <PreviewTable rows={matches} fields={ids} />
                  )}
                </aside>
              ),
            }] : []),
          ] as PaneSpec[]}
        />
      </div>
    </div>
  );
}

function GroupedPreview({ matches, fields, groupBy }: { matches: SearchRow[]; fields: string[]; groupBy: string }) {
  const groups = useMemo(() => groupRows(matches, groupBy), [matches, groupBy]);
  if (groups.length === 0) return <p className="sb-muted" style={{ padding: 14 }}>No matches.</p>;
  return (
    <div className="sb-groups">
      {groups.map((g) => (
        <details key={g.key} className="sb-group-preview" open={groups.length <= 3}>
          <summary><strong>{g.key}</strong><span className="sb-chip">{g.count}</span></summary>
          <PreviewTable rows={g.rows} fields={fields} cap={6} />
        </details>
      ))}
    </div>
  );
}
