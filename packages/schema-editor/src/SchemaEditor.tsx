import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { ThemeToggleButton, PaneLayout, loadInitialState, toFieldDataType, useIdleSave, usePersistedTheme, type FieldDataType, type Layout, type PaneSpec, type PersistenceAdapter, type SheetbaseField, type ThemeMode } from "sheetbase-shared";
import type { SchemaField, SchemaGraph, SchemaModel } from "./types";
import {
  NODE_WIDTH,
  fitTransform,
  getRelations,
  graphBounds,
  rewriteReferences,
  tableHeaderFields,
  validateGraph,
  withAutoLayout,
} from "./graph";
import { ddlToGraph, graphToDdl, graphToProvision, SchemaParseError } from "./ddl";

export interface SchemaEditorHandle {
  /** Add a model, as the topbar button does. */
  addModel(): void;
  /** Fit the graph in the viewport. */
  fitView(): void;
  /** Reset zoom and pan. */
  resetView(): void;
}

export interface SchemaEditorProps {
  /** Controlled graph. Omit for uncontrolled (uses initialGraph once). */
  value?: SchemaGraph;
  initialGraph?: SchemaGraph;
  onChange?: (next: SchemaGraph) => void;
  /** Controlled theme. Omit for uncontrolled (toggle manages it). */
  theme?: ThemeMode;
  defaultTheme?: ThemeMode;
  onThemeChange?: (next: ThemeMode) => void;
  /** Emits table DatasetHeader fields for the selected model whenever the graph changes. */
  onHeaderFieldsChange?: (fields: Array<SheetbaseField & { column: number }>, modelName: string | null) => void;
  persistKey?: string;
  adapter?: PersistenceAdapter<SchemaGraph>;
  /** Omit the component topbar so a host can own pane chrome. Default `"full"`. */
  chrome?: "full" | "none";
  /** Imperative actions for hosts that render pane chrome. */
  ref?: Ref<SchemaEditorHandle>;
}

const FIELD_TYPES: FieldDataType[] = ["text", "number", "boolean", "date", "datetime", "relationship"];

/** Models list | canvas | inspector, each a real pane. */
const SCHEMA_PANE_LAYOUT: Layout = {
  kind: "split",
  id: "schema-root",
  direction: "row",
  sizes: [0.22, 0.56, 0.22],
  children: [
    { kind: "stack", id: "schema-list", panes: ["list"], active: "list" },
    { kind: "stack", id: "schema-canvas", panes: ["canvas"], active: "canvas" },
    { kind: "stack", id: "schema-inspector", panes: ["inspector"], active: "inspector" },
  ],
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Keyboard nudge for a node in canvas coordinates. Plain arrows move 8 canvas
 * units; Shift widens the step to 32. Returns null for non-arrow keys.
 */
export function nudgeNodePosition(position: { x: number; y: number }, key: string, shiftKey = false): { x: number; y: number } | null {
  const step = shiftKey ? 32 : 8;
  if (key === "ArrowLeft") return { x: position.x - step, y: position.y };
  if (key === "ArrowRight") return { x: position.x + step, y: position.y };
  if (key === "ArrowUp") return { x: position.x, y: position.y - step };
  if (key === "ArrowDown") return { x: position.x, y: position.y + step };
  return null;
}

export function SchemaEditor({ value, initialGraph, onChange, theme, defaultTheme = "light", onThemeChange, onHeaderFieldsChange, persistKey, adapter, chrome = "full", ref }: SchemaEditorProps) {
  const [draft, setDraft] = useState<SchemaGraph>(() => withAutoLayout(loadInitialState(persistKey, adapter, initialGraph ?? { models: [] })));
  const graph = withAutoLayout(value ?? draft);
  useIdleSave(persistKey, graph, adapter);
  const { activeTheme, resolvedTheme, toggleTheme } = usePersistedTheme({ theme, defaultTheme, onThemeChange });
  const [selected, setSelected] = useState<string | null>(graph.models[0]?.name ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeDragRef = useRef<{ name: string; x: number; y: number } | null>(null);
  const [nodeDrag, setNodeDrag] = useState<{ name: string; x: number; y: number } | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());

  const relations = useMemo(() => getRelations(graph), [graph]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  function importDdl() {
    try {
      const next = ddlToGraph(importText);
      commit(next, next.models[0]?.name ?? null);
      setImportOpen(false);
      setImportText("");
      setImportError(null);
      setExportNote(`Imported ${next.models.length} model${next.models.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setImportError(error instanceof SchemaParseError ? error.errors.join("; ") : "Could not parse that DDL.");
    }
  }

  function copyExport(text: string, label: string) {
    navigator.clipboard?.writeText(text)
      .then(() => setExportNote(label))
      .catch(() => setExportNote("Clipboard unavailable — copy from the console payload instead."));
  }

  function exportDdl() {
    try { copyExport(graphToDdl(graph), "DDL copied."); }
    catch { setExportNote("Fix validation errors before exporting."); }
  }

  function exportPayload() {
    try { copyExport(JSON.stringify(graphToProvision(graph), null, 2), "Payload copied."); }
    catch { setExportNote("Fix validation errors before exporting."); }
  }
  const errors = useMemo(() => validateGraph(graph), [graph]);
  const selectedModel = graph.models.find((m) => m.name === selected) ?? null;

  function commit(next: SchemaGraph, selectName?: string | null) {
    const laid = withAutoLayout(next);
    if (value === undefined) setDraft(laid);
    onChange?.(laid);
    const nextSelected = selectName !== undefined
      ? selectName
      : (selected && laid.models.some((m) => m.name === selected) ? selected : laid.models[0]?.name ?? null);
    if (nextSelected !== selected) setSelected(nextSelected);
    const model = laid.models.find((m) => m.name === nextSelected) ?? null;
    onHeaderFieldsChange?.(model ? tableHeaderFields(model) : [], model?.name ?? null);
  }

  function selectModel(name: string) {
    setSelected(name);
    const model = graph.models.find((m) => m.name === name) ?? null;
    onHeaderFieldsChange?.(model ? tableHeaderFields(model) : [], model?.name ?? null);
  }

  function addModel() {
    const name = uid("model");
    commit({
      models: [...graph.models, {
        name,
        label: "New model",
        fields: [{ key: "id", type: "text", primaryKey: true }],
        position: { x: 24 + graph.models.length * 24, y: 24 + graph.models.length * 24 },
      }],
    }, name);
  }

  function patchModel(name: string, patch: Partial<SchemaModel>) {
    const renamed = typeof patch.name === "string" && patch.name !== name;
    let next: SchemaGraph = { models: graph.models.map((m) => (m.name === name ? { ...m, ...patch } : m)) };
    if (renamed) next = rewriteReferences(next, { kind: "rename-model", from: name, to: patch.name! });
    commit(next, renamed ? patch.name : undefined);
  }

  function removeModel(name: string) {
    commit(rewriteReferences({ models: graph.models.filter((m) => m.name !== name) }, { kind: "delete-model", name }));
  }

  function addField(modelName: string) {
    commit({
      models: graph.models.map((m) =>
        m.name === modelName ? { ...m, fields: [...m.fields, { key: uid("field"), type: "text" } as SchemaField] } : m,
      ),
    });
  }

  function patchField(modelName: string, index: number, patch: Partial<SchemaField>) {
    const current = graph.models.find((m) => m.name === modelName)?.fields[index];
    let next: SchemaGraph = {
      models: graph.models.map((m) =>
        m.name === modelName ? { ...m, fields: m.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : m,
      ),
    };
    if (current && typeof patch.key === "string" && patch.key !== current.key) {
      next = rewriteReferences(next, { kind: "rename-field", model: modelName, from: current.key, to: patch.key });
    }
    commit(next);
  }

  function removeField(modelName: string, index: number) {
    const current = graph.models.find((m) => m.name === modelName)?.fields[index];
    let next: SchemaGraph = { models: graph.models.map((m) => (m.name === modelName ? { ...m, fields: m.fields.filter((_, i) => i !== index) } : m)) };
    if (current) next = rewriteReferences(next, { kind: "delete-field", model: modelName, key: current.key });
    commit(next);
  }

  function finishNodeDrag() {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    setNodeDrag(null);
    if (!drag) return;
    commit({
      models: graph.models.map((m) => (m.name === drag.name ? { ...m, position: { x: drag.x, y: drag.y } } : m)),
    });
  }

  function fitView() {
    const bounds = graphBounds(graph);
    const el = canvasRef.current;
    if (!bounds || !el) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const view = fitTransform(bounds, el.clientWidth, el.clientHeight);
    setZoom(view.zoom);
    setPan({ x: view.x, y: view.y });
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  useImperativeHandle(ref, () => ({ addModel, fitView, resetView }));

  const posByModel: Record<string, { x: number; y: number }> = {};
  for (const m of graph.models) posByModel[m.name] = m.position ?? { x: 24, y: 24 };
  if (nodeDrag) posByModel[nodeDrag.name] = { x: nodeDrag.x, y: nodeDrag.y };

  return (
    <div className="sheetbase-scope sb-schema" data-theme={resolvedTheme}>
      <div className={chrome === "none" ? "sb-frame no-topbar" : "sb-frame"}>
        {chrome !== "none" && (
          <div className="sb-topbar">
            <div className="sb-toolbar-group">
              <button className="sb-icon-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>−</button>
              <span className="sb-stat" style={{ minWidth: 44, textAlign: "center", fontFamily: "var(--font-sans)" }}>{Math.round(zoom * 100)}%</span>
              <button className="sb-icon-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>+</button>
              <span className="sb-divider" />
              <button className="sb-btn" onClick={fitView}>Fit</button>
              <button className="sb-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
              <span className="sb-divider" />
              <span className="sb-stat">{graph.models.length} models · {relations.length} relations</span>
            </div>
            <div className="sb-topbar-actions">
              {exportNote && <span className="sb-stat">{exportNote}</span>}
              <button
                className="sb-btn"
                title="Paste create-table DDL to replace the graph"
                onClick={() => { setImportOpen(true); setImportError(null); }}
              >Import SQL</button>
              <button
                className="sb-btn"
                disabled={errors.length > 0}
                title={errors.length > 0 ? `Fix validation first: ${errors.join("; ")}` : "Copy create-table DDL (Postgres-flavoured)"}
                onClick={exportDdl}
              >Export SQL</button>
              <button
                className="sb-btn"
                disabled={errors.length > 0}
                title={errors.length > 0 ? `Fix validation first: ${errors.join("; ")}` : "Copy the provisioning payload as JSON"}
                onClick={exportPayload}
              >Export payload</button>
              {theme === undefined && <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />}
              <button className="sb-btn primary" onClick={addModel}>+ Model</button>
            </div>
          </div>
        )}
        <PaneLayout
          className="sb-panes--fit"
          defaultLayout={SCHEMA_PANE_LAYOUT}
          panes={[
            {
              id: "list",
              title: "Models",
              dragHandle: "heading",
              content: (
                <aside className="sb-schema-list sb-plate">
                  <div className="sb-panel-heading"><span>Models</span><span>{graph.models.length}</span></div>
                  <div className="sb-schema-list-items">
                    {graph.models.map((m) => (
                      <button key={m.name} className={m.name === selected ? "sb-schema-row active" : "sb-schema-row"} onClick={() => selectModel(m.name)}>
                        <span className="sb-database-dot" />
                        <span className="sb-schema-row-copy"><strong>{m.label || m.name}</strong><small>{m.fields.length} fields</small></span>
                        {m.fields.some((f) => f.references) && <span className="sb-chip">linked</span>}
                      </button>
                    ))}
                    {graph.models.length === 0 && <p className="sb-muted" style={{ padding: "12px 14px" }}>No models yet — add one to start.</p>}
                  </div>
                  {errors.length > 0 && (
                    <div className="sb-schema-errors">
                      {errors.map((e) => <p key={e}>⚠ {e}</p>)}
                    </div>
                  )}
                </aside>
              ),
            },
            {
              id: "canvas",
              title: "Canvas",
              dragHandle: "heading",
              content: (
                <div className="sb-plate">
                  <div className="sb-panel-heading"><span>Canvas</span></div>
                <div
                  ref={canvasRef}
                  className="sb-schema-canvas"
                  role="group"
                  tabIndex={0}
                  aria-label="Schema canvas. Tab to a model, press Enter to move it. Plus and minus zoom, arrow keys pan, 0 resets the view."
                  onKeyDown={(e) => {
                    if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom((z) => Math.min(2, z + 0.1)); }
                    else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom((z) => Math.max(0.4, z - 0.1)); }
                    else if (e.key === "0") { e.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); }
                    else {
                      const step = e.shiftKey ? 120 : 40;
                      const dp = e.key === "ArrowRight" ? { x: -step, y: 0 }
                        : e.key === "ArrowLeft" ? { x: step, y: 0 }
                        : e.key === "ArrowDown" ? { x: 0, y: -step }
                        : e.key === "ArrowUp" ? { x: 0, y: step }
                        : null;
                      if (dp) { e.preventDefault(); setPan((p) => ({ x: p.x + dp.x, y: p.y + dp.y })); }
                    }
                  }}
                  onWheel={(e) => { if (e.ctrlKey || e.metaKey) setZoom((z) => Math.min(2, Math.max(0.4, z - Math.sign(e.deltaY) * 0.08))); }}
                  onMouseDown={(e) => { if ((e.target as HTMLElement).dataset.pane === "1") dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; }}
                  onMouseMove={(e) => { const d = dragRef.current; if (d) setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }); }}
                  onMouseUp={() => { dragRef.current = null; }}
                  onMouseLeave={() => { dragRef.current = null; }}
                >
                  <div data-pane="1" className="sb-schema-pane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                    <svg className="sb-schema-edges" data-pane="1">
                      {relations.map((r) => {
                        const a = posByModel[r.fromModel]!, b = posByModel[r.toModel]!;
                        const x1 = a.x + NODE_WIDTH, y1 = a.y + 44, x2 = b.x, y2 = b.y + 44;
                        const mx = (x1 + x2) / 2;
                        return <path key={r.id} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} markerEnd="url(#sb-arrow)" />;
                      })}
                      <defs>
                        <marker id="sb-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                          <path d="M0,0 L8,4 L0,8" fill="none" strokeWidth="1.4" className="sb-edge-arrow" />
                        </marker>
                      </defs>
                    </svg>
                    {graph.models.map((m) => {
                      const p = posByModel[m.name]!;
                      const moving = moveTarget === m.name;
                      return (
                        <div
                          key={m.name}
                          ref={(el) => { if (el) nodeRefs.current.set(m.name, el); else nodeRefs.current.delete(m.name); }}
                          role="group"
                          tabIndex={0}
                          aria-label={`${m.label || m.name}, ${m.fields.length} field${m.fields.length === 1 ? "" : "s"}${moving ? ", moving" : ""}`}
                          className={`sb-node${m.name === selected ? " active" : ""}${moving ? " moving" : ""}`}
                          style={{ left: p.x, top: p.y, width: NODE_WIDTH }}
                          onFocus={() => selectModel(m.name)}
                          onBlur={() => {
                            if (moveTarget === m.name) {
                              setMoveTarget(null);
                              setAnnouncement(`${m.label || m.name} placed at ${Math.round(p.x)}, ${Math.round(p.y)}.`);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (moving) {
                              if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setMoveTarget(null);
                                setAnnouncement(`${m.label || m.name} placed at ${Math.round(p.x)}, ${Math.round(p.y)}.`);
                                return;
                              }
                              const next = nudgeNodePosition(p, e.key, e.shiftKey);
                              if (next) {
                                e.preventDefault();
                                e.stopPropagation();
                                patchModel(m.name, { position: next });
                              }
                              return;
                            }
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setMoveTarget(m.name);
                              setAnnouncement(`Moving ${m.label || m.name}. Arrow keys nudge the model, Enter or Escape finishes.`);
                              return;
                            }
                            const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                            if (delta !== 0 && graph.models.length > 1) {
                              e.preventDefault();
                              e.stopPropagation();
                              const index = graph.models.findIndex((x) => x.name === m.name);
                              const next = graph.models[(index + delta + graph.models.length) % graph.models.length]!;
                              selectModel(next.name);
                              nodeRefs.current.get(next.name)?.focus();
                            }
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelected(m.name);
                            const origin = m.position ?? { x: 24, y: 24 };
                            nodeDragRef.current = { name: m.name, x: origin.x, y: origin.y };
                            setNodeDrag(nodeDragRef.current);
                            let lx = e.clientX, ly = e.clientY;
                            const track = (ev: MouseEvent) => {
                              const current = nodeDragRef.current;
                              if (!current) return;
                              const next = { name: current.name, x: current.x + (ev.clientX - lx) / zoom, y: current.y + (ev.clientY - ly) / zoom };
                              lx = ev.clientX;
                              ly = ev.clientY;
                              nodeDragRef.current = next;
                              setNodeDrag(next);
                            };
                            const stop = () => {
                              window.removeEventListener("mousemove", track);
                              finishNodeDrag();
                            };
                            window.addEventListener("mousemove", track);
                            window.addEventListener("mouseup", stop, { once: true });
                          }}
                        >
                          <header><strong>{m.label || m.name}</strong><small>{m.name}</small></header>
                          <ul>
                            {m.fields.map((f) => (
                              <li key={f.key}>
                                <span className={`sb-type type-${f.type}`}>{f.type[0]!.toUpperCase()}</span>
                                <span className="sb-node-field">{f.key}</span>
                                {f.primaryKey && <span className="sb-chip">PK</span>}
                                {f.references && <span className="sb-chip link">→ {f.references.model}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                  <div className="sb-schema-live" aria-live="polite" aria-atomic="true">{announcement}</div>
                </div>
                </div>
              ),
            },
            {
              id: "inspector",
              title: "Inspector",
              dragHandle: "heading",
              content: (
                <aside className="sb-schema-inspector sb-plate">
                  <div className="sb-panel-heading"><span>Inspector</span></div>
                  {!selectedModel ? (
                    <p className="sb-muted" style={{ padding: 14 }}>Select a model.</p>
                  ) : (
                    <div className="sb-inspector-scroll">
                      <section>
                        <h3>Model</h3>
                        <label className="sb-compact"><span>Table</span><input className="sb-input sb-mono" value={selectedModel.name} onChange={(e) => patchModel(selectedModel.name, { name: e.target.value.replace(/\s+/g, "_") })} /></label>
                        <label className="sb-compact"><span>Label</span><input className="sb-input" value={selectedModel.label ?? ""} placeholder={selectedModel.name} onChange={(e) => patchModel(selectedModel.name, { label: e.target.value || undefined })} /></label>
                        <div className="sb-row-btns">
                          <button className="sb-link-btn" onClick={() => addField(selectedModel.name)}>+ Field</button>
                          <button className="sb-link-btn danger" onClick={() => removeModel(selectedModel.name)}>Delete model</button>
                        </div>
                      </section>
                      <section>
                        <h3>Fields · {selectedModel.fields.length}</h3>
                        {selectedModel.fields.map((f, i) => (
                          <div className="sb-field" key={`${f.key}-${i}`}>
                            <div className="sb-field-key">
                              <input className="sb-input sb-mono" aria-label="Field key" value={f.key} onChange={(e) => patchField(selectedModel.name, i, { key: e.target.value.replace(/\s+/g, "_") })} />
                              <button className="sb-remove" title="Remove field" onClick={() => removeField(selectedModel.name, i)}>×</button>
                            </div>
                            <label className="sb-compact"><span>Type</span>
                              <select
                                className="sb-select"
                                aria-label="Field type"
                                value={toFieldDataType(f.type)}
                                onChange={(e) => patchField(selectedModel.name, i, { type: toFieldDataType(e.target.value) })}
                              >
                                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </label>
                            <label className="sb-compact"><span>Related</span>
                              <select
                                className="sb-select"
                                aria-label="References model"
                                value={f.references?.model ?? ""}
                                onChange={(e) => patchField(selectedModel.name, i, {
                                  references: e.target.value ? { model: e.target.value } : undefined,
                                  type: e.target.value ? "relationship" : f.type === "relationship" ? "text" : f.type,
                                })}
                              >
                                <option value="">no relation</option>
                                {graph.models.filter((m) => m.name !== selectedModel.name).map((m) => <option key={m.name} value={m.name}>→ {m.name}</option>)}
                              </select>
                            </label>
                            <div className="sb-toggle-row">
                              <label><input type="checkbox" checked={!!f.primaryKey} onChange={(e) => patchField(selectedModel.name, i, { primaryKey: e.target.checked || undefined })} /> Primary key</label>
                              <label><input type="checkbox" checked={f.nullable ?? true} onChange={(e) => patchField(selectedModel.name, i, { nullable: e.target.checked })} /> Nullable</label>
                            </div>
                          </div>
                        ))}
                      </section>
                    </div>
                  )}
                </aside>
              ),
            },
          ] satisfies PaneSpec[]}
        />
        {importOpen && (
          <div className="sb-import-backdrop" onClick={() => setImportOpen(false)}>
            <div className="sb-import-panel" role="dialog" aria-label="Import SQL" onClick={(e) => e.stopPropagation()}>
              <div className="sb-panel-heading"><span>Import DDL</span><span>replaces the graph</span></div>
              <textarea
                className="sb-input sb-mono sb-import-sql"
                autoFocus
                spellCheck={false}
                placeholder={'create table "samples" (\n  "id" text primary key,\n  …\n);'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") importDdl(); if (e.key === "Escape") setImportOpen(false); }}
              />
              {importError && <p className="sb-import-error">{importError}</p>}
              <div className="sb-import-actions">
                <button className="sb-btn" onClick={() => setImportOpen(false)}>Cancel</button>
                <button className="sb-btn primary" disabled={!importText.trim()} onClick={importDdl}>Import</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
