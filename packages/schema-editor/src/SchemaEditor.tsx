import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { ThemeToggleButton, PaneLayout, loadInitialState, toFieldDataType, useIdleSave, usePersistedTheme, type FieldDataType, type Layout, type PaneSpec, type PersistenceAdapter, type SheetbaseField, type ThemeMode } from "sheetbase-shared";
import type { SchemaField, SchemaGraph, SchemaModel, SchemaModelKind, SchemaRelationKind } from "./types";
import {
  NODE_WIDTH,
  fitTransform,
  getRelations,
  graphBounds,
  isDerivedModel,
  nodeHeight,
  relatedModels,
  rewriteReferences,
  tableHeaderFields,
  validateGraph,
  withAutoLayout,
} from "./graph";
import { graphToDdl, graphToProvision, SchemaParseError } from "./ddl";
import { analyzeSql, type SqlAnalysis } from "./sql";

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

/** Query-import node badges — absent kind means a plain table. */
const MODEL_KIND_LABELS: Partial<Record<SchemaModelKind, string>> = {
  cte: "CTE",
  subquery: "subquery",
  query: "query",
  view: "view",
};

const RELATION_KINDS: readonly SchemaRelationKind[] = ["reference", "join", "lineage"];

type ImportPreview =
  | { error: string }
  | { analysis: SqlAnalysis; tables: number; derived: number; relations: number };

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

/** Gap between the arrowhead tip and the node border. */
export const EDGE_GAP = 6;
const EDGE_ANCHOR_Y = 42;

/**
 * Route an edge from the source node's near side to the target node's near
 * side, leaving room for the arrowhead. Targets to the left connect to their
 * right edge, so an arrow never lands inside a node.
 */
export function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  toHeight: number,
  offset = 0,
): string {
  const targetLeft = to.x + NODE_WIDTH <= from.x + 16;
  const x1 = targetLeft ? from.x : from.x + NODE_WIDTH;
  const x2 = targetLeft ? to.x + NODE_WIDTH + EDGE_GAP : to.x - EDGE_GAP;
  const y1 = from.y + EDGE_ANCHOR_Y;
  const y2 = Math.min(Math.max(to.y + EDGE_ANCHOR_Y + offset, to.y + 14), to.y + Math.max(20, toHeight - 10));
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function SchemaEditor({ value, initialGraph, onChange, theme, defaultTheme = "light", onThemeChange, onHeaderFieldsChange, persistKey, adapter, chrome = "full", ref }: SchemaEditorProps) {
  const [draft, setDraft] = useState<SchemaGraph>(() => withAutoLayout(loadInitialState(persistKey, adapter, initialGraph ?? { models: [] })));
  const graph = withAutoLayout(value ?? draft);
  useIdleSave(persistKey, graph, adapter);
  const { activeTheme, resolvedTheme, toggleTheme } = usePersistedTheme({ theme, defaultTheme, onThemeChange });
  const [selected, setSelected] = useState<string | null>(graph.models[0]?.name ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; panRef.current = pan; }, [zoom, pan]);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Focus mode: dim everything the selection does not touch. */
  const [focusMode, setFocusMode] = useState(true);
  const nodeDragRef = useRef<{ name: string; x: number; y: number } | null>(null);
  const [nodeDrag, setNodeDrag] = useState<{ name: string; x: number; y: number } | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());

  /** Zoom anchored at a viewport point (the canvas centre when omitted). */
  const zoomAt = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const clamped = Math.min(2, Math.max(0.4, +nextZoom.toFixed(3)));
    if (clamped === currentZoom) return;
    const px = clientX !== undefined && rect ? clientX - rect.left : (el?.clientWidth ?? 0) / 2;
    const py = clientY !== undefined && rect ? clientY - rect.top : (el?.clientHeight ?? 0) / 2;
    setZoom(clamped);
    setPan({ x: px - ((px - currentPan.x) / currentZoom) * clamped, y: py - ((py - currentPan.y) / currentZoom) * clamped });
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // Native listener: React's onWheel is passive, so it cannot preventDefault.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Horizontal gestures (trackpad swipe, shift+wheel) pan; the wheel zooms.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        setPan((current) => ({ x: current.x - event.deltaX, y: current.y }));
        return;
      }
      zoomAt(zoomRef.current * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const relations = useMemo(() => getRelations(graph), [graph]);
  /** Incoming-edge slots per target model so parallel arrows do not overlap. */
  const edgeSlots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of relations) counts.set(relation.toModel, (counts.get(relation.toModel) ?? 0) + 1);
    const used = new Map<string, number>();
    const slots = new Map<string, { index: number; count: number }>();
    for (const relation of relations) {
      const index = used.get(relation.toModel) ?? 0;
      used.set(relation.toModel, index + 1);
      slots.set(relation.id, { index, count: counts.get(relation.toModel) ?? 1 });
    }
    return slots;
  }, [relations]);
  /** Selected model plus everything it links to — null when focus mode is off. */
  const focusedModels = useMemo(
    () => (focusMode && selected ? relatedModels(relations, selected) : null),
    [focusMode, relations, selected],
  );
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFiles, setImportFiles] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const importBackdropRef = useRef<HTMLDivElement>(null);
  const importTextareaRef = useRef<HTMLTextAreaElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const importPreview = useMemo<ImportPreview | null>(() => {
    if (!importText.trim()) return null;
    try {
      const analysis = analyzeSql(importText);
      const derived = analysis.graph.models.filter(isDerivedModel).length;
      return {
        analysis,
        tables: analysis.graph.models.length - derived,
        derived,
        relations: getRelations(analysis.graph).length,
      };
    } catch (error) {
      return { error: error instanceof SchemaParseError ? error.errors.join("; ") : "Could not parse that SQL." };
    }
  }, [importText]);

  useEffect(() => {
    if (!importOpen) return;
    importTextareaRef.current?.focus();
    const backdrop = importBackdropRef.current;
    const onPointerDown = (event: MouseEvent) => { if (event.target === backdrop) setImportOpen(false); };
    backdrop?.addEventListener("mousedown", onPointerDown);
    return () => backdrop?.removeEventListener("mousedown", onPointerDown);
  }, [importOpen]);

  function importSql() {
    try {
      const analysis = analyzeSql(importText);
      commit(analysis.graph, analysis.graph.models[0]?.name ?? null);
      const derived = analysis.graph.models.filter(isDerivedModel).length;
      const notes = analysis.warnings.length;
      setImportOpen(false);
      setImportText("");
      setImportFiles([]);
      setImportError(null);
      setExportNote(
        `Imported ${analysis.graph.models.length} model${analysis.graph.models.length === 1 ? "" : "s"}` +
        `${derived > 0 ? ` (${derived} query node${derived === 1 ? "" : "s"})` : ""}` +
        ` · ${getRelations(analysis.graph).length} relation${getRelations(analysis.graph).length === 1 ? "" : "s"}` +
        `${notes > 0 ? ` · ${notes} note${notes === 1 ? "" : "s"}` : ""}.`,
      );
    } catch (error) {
      setImportError(error instanceof SchemaParseError ? error.errors.join("; ") : "Could not parse that SQL.");
    }
  }

  async function addImportFiles(files: FileList | File[]) {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    const parts: string[] = [];
    const names: string[] = [];
    for (const file of picked) {
      try {
        const text = await file.text();
        parts.push(`-- ${file.name}\n${text.trimEnd()}`);
        names.push(file.name);
      } catch {
        setImportError(`Could not read ${file.name}.`);
      }
    }
    if (parts.length === 0) return;
    setImportText((previous) => (previous.trim() ? `${previous.trimEnd()}\n\n${parts.join("\n\n")}` : parts.join("\n\n")));
    setImportFiles((previous) => [...previous, ...names]);
  }

  function copyExport(text: string, label: string) {
    navigator.clipboard?.writeText(text)
      .then(() => setExportNote(label))
      .catch(() => setExportNote("Clipboard unavailable — copy from the console payload instead."));
  }

  function exportDdl() {
    try {
      const derived = graph.models.filter(isDerivedModel).length;
      copyExport(graphToDdl(graph), derived > 0 ? `DDL copied · ${derived} query node${derived === 1 ? "" : "s"} skipped.` : "DDL copied.");
    } catch { setExportNote("Fix validation errors before exporting."); }
  }

  function exportPayload() {
    try {
      const derived = graph.models.filter(isDerivedModel).length;
      copyExport(JSON.stringify(graphToProvision(graph), null, 2), derived > 0 ? `Payload copied · ${derived} query node${derived === 1 ? "" : "s"} skipped.` : "Payload copied.");
    } catch { setExportNote("Fix validation errors before exporting."); }
  }
  const errors = useMemo(() => validateGraph(graph), [graph]);
  const selectedModel = graph.models.find((m) => m.name === selected) ?? null;
  const selectedLinks = selectedModel
    ? relations.filter((relation) => relation.fromModel === selectedModel.name || relation.toModel === selectedModel.name)
    : [];
  const relationKinds = new Set(relations.map((relation) => relation.kind ?? "reference"));

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
      ...graph,
      models: [...graph.models, {
        name,
        label: "New model",
        fields: [{ key: "id", type: "text", primaryKey: true }],
        position: { x: 24 + graph.models.length * 24, y: 24 + graph.models.length * 24 },
      }],
    }, name);
  }

  function patchModel(name: string, patch: Partial<SchemaModel>) {
    const newName = typeof patch.name === "string" && patch.name !== name ? patch.name : undefined;
    let next: SchemaGraph = { ...graph, models: graph.models.map((m) => (m.name === name ? { ...m, ...patch } : m)) };
    if (newName) next = rewriteReferences(next, { kind: "rename-model", from: name, to: newName });
    commit(next, newName);
  }

  function removeModel(name: string) {
    commit(rewriteReferences({ ...graph, models: graph.models.filter((m) => m.name !== name) }, { kind: "delete-model", name }));
  }

  function addField(modelName: string) {
    commit({
      ...graph,
      models: graph.models.map((m) =>
        m.name === modelName ? { ...m, fields: [...m.fields, { key: uid("field"), type: "text" } as SchemaField] } : m,
      ),
    });
  }

  function patchField(modelName: string, index: number, patch: Partial<SchemaField>) {
    const current = graph.models.find((m) => m.name === modelName)?.fields[index];
    let next: SchemaGraph = {
      ...graph,
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
    let next: SchemaGraph = { ...graph, models: graph.models.map((m) => (m.name === modelName ? { ...m, fields: m.fields.filter((_, i) => i !== index) } : m)) };
    if (current) next = rewriteReferences(next, { kind: "delete-field", model: modelName, key: current.key });
    commit(next);
  }

  function finishNodeDrag() {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    setNodeDrag(null);
    if (!drag) return;
    commit({
      ...graph,
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

  const modelByName = new Map(graph.models.map((m) => [m.name, m]));
  const posByModel: Record<string, { x: number; y: number }> = {};
  for (const m of graph.models) posByModel[m.name] = m.position ?? { x: 24, y: 24 };
  if (nodeDrag) posByModel[nodeDrag.name] = { x: nodeDrag.x, y: nodeDrag.y };

  return (
    <div className="sheetbase-scope sb-schema" data-theme={resolvedTheme}>
      <div className={chrome === "none" ? "sb-frame no-topbar" : "sb-frame"}>
        {chrome !== "none" && (
          <div className="sb-topbar">
            <div className="sb-toolbar-group">
              <button type="button" className="sb-icon-btn" title="Zoom out (the wheel zooms too)" onClick={() => zoomAt(zoom / 1.15)}>−</button>
              <span className="sb-stat" style={{ minWidth: 44, textAlign: "center", fontFamily: "var(--font-sans)" }}>{Math.round(zoom * 100)}%</span>
              <button type="button" className="sb-icon-btn" title="Zoom in (the wheel zooms too)" onClick={() => zoomAt(zoom * 1.15)}>+</button>
              <span className="sb-divider" />
              <button type="button" className="sb-btn" onClick={fitView}>Fit</button>
              <button type="button" className="sb-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
              <button type="button"
                className={focusMode ? "sb-btn toggled" : "sb-btn"}
                aria-pressed={focusMode}
                title="Grey out models that are not upstream or downstream of the selection"
                onClick={() => setFocusMode((on) => !on)}
              >Focus</button>
              <span className="sb-divider" />
              <span className="sb-stat">{graph.models.length} models · {relations.length} relations</span>
            </div>
            <div className="sb-topbar-actions">
              {exportNote && <span className="sb-stat">{exportNote}</span>}
              <button type="button"
                className="sb-btn"
                title="Paste or drop SQL — create-table DDL or query SQL (Trino, Postgres, DuckDB) — to replace the graph"
                onClick={() => { setImportOpen(true); setImportError(null); }}
              >Import SQL</button>
              <button type="button"
                className="sb-btn"
                disabled={errors.length > 0}
                title={errors.length > 0 ? `Fix validation first: ${errors.join("; ")}` : "Copy create-table DDL (Postgres-flavoured); query-import nodes are skipped"}
                onClick={exportDdl}
              >Export SQL</button>
              <button type="button"
                className="sb-btn"
                disabled={errors.length > 0}
                title={errors.length > 0 ? `Fix validation first: ${errors.join("; ")}` : "Copy the provisioning payload as JSON; query-import nodes are skipped"}
                onClick={exportPayload}
              >Export payload</button>
              {theme === undefined && <ThemeToggleButton theme={activeTheme} onToggle={toggleTheme} />}
              <button type="button" className="sb-btn primary" onClick={addModel}>+ Model</button>
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
                      <button type="button" key={m.name} className={m.name === selected ? "sb-schema-row active" : "sb-schema-row"} onClick={() => selectModel(m.name)}>
                        <span className="sb-database-dot" />
                        <span className="sb-schema-row-copy"><strong>{m.label || m.name}</strong><small>{m.fields.length} fields</small></span>
                        {m.kind && m.kind !== "table" && <span className="sb-chip">{MODEL_KIND_LABELS[m.kind]}</span>}
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
                {/* biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveElementInteractions: keyboard-driven pan/zoom canvas is a custom widget; no semantic element covers it */}
                <div
                  ref={canvasRef}
                  className="sb-schema-canvas"
                  role="group"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas is the keyboard focus target for pan/zoom; roving focus requires tabindex
                  tabIndex={0}
                  aria-label="Schema canvas. Tab to a model, press Enter to move it. The wheel zooms, drag pans, plus and minus zoom, arrow keys pan, 0 resets the view."
                  onKeyDown={(e) => {
                    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(zoom * 1.1); }
                    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(zoom / 1.1); }
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
                  onMouseDown={(e) => {
                    if (e.button !== 0 && e.button !== 1) return;
                    // Left-drag on a node moves the node; middle-drag pans anywhere.
                    if (e.button === 0 && (e.target as HTMLElement).closest(".sb-node")) return;
                    if (e.button === 1) e.preventDefault();
                    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
                    // Track on the window so a pan that leaves the canvas keeps going.
                    const track = (event: MouseEvent) => {
                      const current = dragRef.current;
                      if (!current) return;
                      setPan({ x: current.px + (event.clientX - current.sx), y: current.py + (event.clientY - current.sy) });
                    };
                    const stop = () => {
                      window.removeEventListener("mousemove", track);
                      dragRef.current = null;
                    };
                    window.addEventListener("mousemove", track);
                    window.addEventListener("mouseup", stop, { once: true });
                  }}
                  onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
                >
                  <div className="sb-schema-pane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                    <svg className="sb-schema-edges">
                      <title>Schema relationships</title>
                      {relations.map((r) => {
                        const a = posByModel[r.fromModel], b = posByModel[r.toModel];
                        if (!a || !b) return null;
                        const kind = r.kind ?? "reference";
                        const marker = `url(#sb-arrow-${kind})`;
                        const dimmed = focusedModels ? r.fromModel !== selected && r.toModel !== selected : false;
                        if (r.fromModel === r.toModel) {
                          const x1 = a.x + NODE_WIDTH * 0.72, y1 = a.y, x2 = a.x + NODE_WIDTH * 0.28, y2 = a.y;
                          return (
                            <path key={r.id} className={`sb-edge-${kind}${dimmed ? " dimmed" : ""}`} d={`M ${x1} ${y1} C ${x1 + 48} ${y1 - 56}, ${x2 - 48} ${y2 - 56}, ${x2} ${y2}`} markerEnd={dimmed ? undefined : marker}>
                              {r.label && <title>{r.label}</title>}
                            </path>
                          );
                        }
                        const target = modelByName.get(r.toModel);
                        const slot = edgeSlots.get(r.id);
                        const offset = slot ? (slot.index - (slot.count - 1) / 2) * 14 : 0;
                        return (
                          <path key={r.id} className={`sb-edge-${kind}${dimmed ? " dimmed" : ""}`} d={edgePath(a, b, target ? nodeHeight(target) : 60, offset)} markerEnd={dimmed ? undefined : marker}>
                            {r.label && <title>{r.label}</title>}
                          </path>
                        );
                      })}
                      <defs>
                        {RELATION_KINDS.map((kind) => (
                          <marker key={kind} id={`sb-arrow-${kind}`} markerWidth="12" markerHeight="10" refX="10.5" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                            <path d="M0.5,0.5 L11,5 L0.5,9.5 Z" className={`sb-edge-arrow-${kind}`} />
                          </marker>
                        ))}
                      </defs>
                    </svg>
                    {graph.models.map((m) => {
                      const p = posByModel[m.name];
                      if (!p) return null;
                      const moving = moveTarget === m.name;
                      const kindLabel = m.kind && m.kind !== "table" ? MODEL_KIND_LABELS[m.kind] : null;
                      const dimmed = focusedModels ? !focusedModels.has(m.name) : false;
                      return (
                        // biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveElementInteractions: movable canvas node is a custom widget; Enter-to-move plus arrow-key nudge have no semantic equivalent
                        <div
                          key={m.name}
                          ref={(el) => { if (el) nodeRefs.current.set(m.name, el); else nodeRefs.current.delete(m.name); }}
                          role="group"
                          // biome-ignore lint/a11y/noNoninteractiveTabindex: nodes participate in roving focus so arrows can move between models
                          tabIndex={0}
                          aria-label={`${m.label || m.name}${kindLabel ? ` (${kindLabel})` : ""}, ${m.fields.length} field${m.fields.length === 1 ? "" : "s"}${moving ? ", moving" : ""}`}
                          className={`sb-node${m.name === selected ? " active" : ""}${moving ? " moving" : ""}${kindLabel ? ` kind-${m.kind}` : ""}${dimmed ? " dimmed" : ""}`}
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
                              const next = graph.models[(index + delta + graph.models.length) % graph.models.length];
                              if (!next) return;
                              selectModel(next.name);
                              nodeRefs.current.get(next.name)?.focus();
                            }
                          }}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return; // middle/right bubble to the canvas so it can pan
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
                          <header>
                            <div className="sb-node-title">
                              <strong>{m.label || m.name}</strong>
                              {kindLabel && <span className="sb-kind-chip">{kindLabel}</span>}
                            </div>
                            <small>{m.name}</small>
                          </header>
                          <ul>
                            {m.fields.map((f) => (
                              <li key={f.key}>
                                <span className={`sb-type type-${f.type}`} title={f.expression ? `${f.expression} · ${f.type}` : f.type}>{f.type[0]?.toUpperCase()}</span>
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
                  {relations.length > 0 && (
                    <div className="sb-schema-legend">
                      {RELATION_KINDS.filter((kind) => relationKinds.has(kind)).map((kind) => (
                        <span key={kind}><i className={`sb-legend-edge sb-legend-${kind}`} aria-hidden="true" />{kind}</span>
                      ))}
                    </div>
                  )}
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
                        {isDerivedModel(selectedModel) && (
                          <p className="sb-derived-note">
                            {MODEL_KIND_LABELS[selectedModel.kind ?? "query"]} · imported from SQL — not emitted as DDL
                          </p>
                        )}
                        <label className="sb-compact"><span>Table</span><input className="sb-input sb-mono" value={selectedModel.name} onChange={(e) => patchModel(selectedModel.name, { name: e.target.value.replace(/\s+/g, "_") })} /></label>
                        <label className="sb-compact"><span>Label</span><input className="sb-input" value={selectedModel.label ?? ""} placeholder={selectedModel.name} onChange={(e) => patchModel(selectedModel.name, { label: e.target.value || undefined })} /></label>
                        <div className="sb-row-btns">
                          <button type="button" className="sb-link-btn" onClick={() => addField(selectedModel.name)}>+ Field</button>
                          <button type="button" className="sb-link-btn danger" onClick={() => removeModel(selectedModel.name)}>Delete model</button>
                        </div>
                        {selectedModel.sql && (
                          <details className="sb-sql-details">
                            <summary>SQL</summary>
                            <pre>{selectedModel.sql}</pre>
                          </details>
                        )}
                      </section>
                      <section>
                        <h3>Fields · {selectedModel.fields.length}</h3>
                        {selectedModel.fields.map((f, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: fields are edited positionally and their key is mutable while typing, so index is the stable ingredient
                          <div className="sb-field" key={`${f.key}-${i}`}>
                            <div className="sb-field-key">
                              <input className="sb-input sb-mono" aria-label="Field key" value={f.key} onChange={(e) => patchField(selectedModel.name, i, { key: e.target.value.replace(/\s+/g, "_") })} />
                              <button type="button" className="sb-remove" title="Remove field" onClick={() => removeField(selectedModel.name, i)}>×</button>
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
                            {f.expression && <div className="sb-field-expr" title={f.expression}>{f.expression}</div>}
                            <div className="sb-toggle-row">
                              <label><input type="checkbox" checked={!!f.primaryKey} onChange={(e) => patchField(selectedModel.name, i, { primaryKey: e.target.checked || undefined })} /> Primary key</label>
                              <label><input type="checkbox" checked={f.nullable ?? true} onChange={(e) => patchField(selectedModel.name, i, { nullable: e.target.checked })} /> Nullable</label>
                            </div>
                          </div>
                        ))}
                      </section>
                      {selectedLinks.length > 0 && (
                        <section>
                          <h3>Links · {selectedLinks.length}</h3>
                          {selectedLinks.map((relation) => (
                            <p className="sb-link-row" key={relation.id} title={relation.label}>
                              <span className={`sb-link-kind kind-${relation.kind ?? "reference"}`}>{relation.kind ?? "reference"}</span>
                              <span className="sb-mono">{relation.fromModel}.{relation.fromField || "*"} → {relation.toModel}.{relation.toField || "*"}</span>
                            </p>
                          ))}
                        </section>
                      )}
                    </div>
                  )}
                </aside>
              ),
            },
          ] satisfies PaneSpec[]}
        />
        {importOpen && (
          <div className="sb-import-backdrop" ref={importBackdropRef}>
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the dialog accepts dropped .sql files; the same import is reachable from the Add .sql files button */}
            <div
              className={`sb-import-panel${importDragOver ? " dropping" : ""}`}
              role="dialog"
              aria-label="Import SQL"
              onDragOver={(event) => { event.preventDefault(); setImportDragOver(true); }}
              onDragLeave={() => setImportDragOver(false)}
              onDrop={(event) => { event.preventDefault(); setImportDragOver(false); void addImportFiles(event.dataTransfer.files); }}
            >
              <div className="sb-panel-heading"><span>Import SQL</span><span>replaces the graph</span></div>
              <p className="sb-import-hint">Paste DDL or query SQL (Trino, Postgres, DuckDB) or drop .sql files. Queries draw their tables, joins, CTEs and result columns on the canvas.</p>
              <textarea
                ref={importTextareaRef}
                className="sb-input sb-mono sb-import-sql"
                spellCheck={false}
                placeholder={'create table "samples" (\n  "id" text primary key\n);\n\nselect c.id, sum(o.total) as total\nfrom orders o join customers c on o.customer_id = c.id\ngroup by c.id;'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") importSql(); if (e.key === "Escape") setImportOpen(false); }}
              />
              <div className="sb-import-files">
                <input ref={importFileRef} type="file" accept=".sql,.txt,text/plain" multiple hidden onChange={(event) => {
                  const files = event.target.files;
                  if (files) void addImportFiles(files);
                  event.target.value = "";
                }} />
                <button type="button" className="sb-btn" onClick={() => importFileRef.current?.click()}>Add .sql files</button>
                {importFiles.length > 0
                  ? <span className="sb-muted">{importFiles.join(", ")}</span>
                  : <span className="sb-muted">or drop files anywhere in this dialog</span>}
              </div>
              {importPreview && ("error" in importPreview ? (
                <p className="sb-import-error">{importPreview.error}</p>
              ) : (
                <div className="sb-import-preview" aria-live="polite">
                  <p>
                    {importPreview.tables} table{importPreview.tables === 1 ? "" : "s"} · {importPreview.derived} query node{importPreview.derived === 1 ? "" : "s"} · {importPreview.relations} relation{importPreview.relations === 1 ? "" : "s"}
                  </p>
                  {importPreview.analysis.warnings.length > 0 && (
                    <ul>
                      {importPreview.analysis.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
                      {importPreview.analysis.warnings.length > 4 && <li>…and {importPreview.analysis.warnings.length - 4} more</li>}
                    </ul>
                  )}
                </div>
              ))}
              {importError && <p className="sb-import-error">{importError}</p>}
              <div className="sb-import-actions">
                <button type="button" className="sb-btn" onClick={() => setImportOpen(false)}>Cancel</button>
                <button type="button" className="sb-btn primary" disabled={!importText.trim() || !importPreview || "error" in importPreview} onClick={importSql}>Import</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
