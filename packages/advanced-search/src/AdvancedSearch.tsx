import { useEffect, useMemo, useState } from "react";
import {
  ThemeToggleButton,
  compileToDatasetQuery,
  countNodes,
  describeFilter,
  emptyCondition,
  emptyRoot,
  groupRows,
  normaliseOperator,
  operatorShortLabel,
  operatorsForField,
  usePersistedTheme,
  type Combinator,
  type ConditionNode,
  type DatasetQuery,
  type FilterNode,
  type FilterOperator,
  type GroupNode,
  type SearchSpec,
  type SheetbaseField,
  type ThemeMode,
  loadInitialState,
  useIdleSave,
  type PersistenceAdapter,
} from "sheetbase-shared";
import { applySearch } from "./predicate";
import type { SearchOperator, SearchRow } from "./types";

export type SearchFieldInput = string | SheetbaseField;

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
  /** Fired whenever the tree flattens onto DatasetQuery (undefined when nested/NOT). */
  onDatasetQueryChange?: (query: DatasetQuery | undefined) => void;
  persistKey?: string;
  adapter?: PersistenceAdapter<SearchSpec>;
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

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
        <select aria-label="Field" value={node.field} onChange={(e) => patch({ field: e.target.value })}>
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

function PreviewTable({ rows, fields, cap = 60 }: { rows: SearchRow[]; fields: string[]; cap?: number }) {
  const columns = previewColumns(rows, fields);
  if (columns.length === 0) return <p className="sb-muted" style={{ padding: 14 }}>No columns.</p>;
  return (
    <div className="sb-table-wrap">
      <table className="sb-table">
        <thead><tr><th className="sb-rownum">#</th>{columns.map((c) => <th key={c.key}>{c.key}<span>{c.kind}</span></th>)}</tr></thead>
        <tbody>
          {rows.slice(0, cap).map((row, i) => (
            <tr key={i}><td className="sb-rownum">{i + 1}</td>{columns.map((c) => <td key={c.key}>{cellText(row[c.key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdvancedSearch({ value, initialSpec, onChange, fields = [], rows = [], theme, defaultTheme = "light", onThemeChange, onDatasetQueryChange, persistKey, adapter }: AdvancedSearchProps) {
  const [draft, setDraft] = useState<SearchSpec>(() => loadInitialState(persistKey, adapter, initialSpec ?? { filter: emptyRoot() }));
  const spec = value ?? draft;
  useIdleSave(persistKey, spec, adapter);
  const { activeTheme, toggleTheme } = usePersistedTheme({ theme, defaultTheme, onThemeChange });

  function commit(next: SearchSpec) {
    if (value === undefined) setDraft(next);
    onChange?.(next);
  }
  function patchFilter(id: string, fn: (node: FilterNode) => FilterNode | null) {
    commit({ ...spec, filter: updateNode(spec.filter, id, fn) });
  }

  const matches = useMemo(() => (rows.length > 0 ? applySearch(rows, spec) : null), [rows, spec]);
  const nodes = countNodes(spec.filter);
  const flattened = compileToDatasetQuery(
    spec.filter,
    spec.sort ? [{ fieldId: spec.sort.field, direction: spec.sort.direction }] : undefined,
  );
  const ids = fieldIds(fields);

  useEffect(() => {
    onDatasetQueryChange?.(flattened);
  }, [flattened, onDatasetQueryChange]);

  return (
    <div className="sheetbase-scope sb-search" data-theme={activeTheme}>
      <div className="sb-frame">
        <div className="sb-topbar">
          <div className="sb-topbar-actions">
            {matches && <span className="sb-stat">{matches.length} / {rows.length} match</span>}
            <span className="sb-stat" title={describeFilter(spec.filter)}>{nodes.conditions} conditions · {nodes.groups} groups{flattened ? " · flat query" : ""}</span>
            <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />
            <button className="sb-btn" onClick={() => commit({ filter: emptyRoot() })}>Clear</button>
          </div>
        </div>
        <div className="sb-search-body sb-plates">
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
          <aside className="sb-search-side sb-plate">
            <div className="sb-panel-heading"><span>Data</span>{matches && <span>{matches.length} / {rows.length} rows</span>}</div>
            {!matches ? (
              <p className="sb-muted" style={{ padding: 14 }}>Pass <code>rows</code> to preview matches live.</p>
            ) : spec.groupBy ? (
              <GroupedPreview matches={matches} fields={ids} groupBy={spec.groupBy} />
            ) : (
              <PreviewTable rows={matches} fields={ids} />
            )}
          </aside>
        </div>
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
