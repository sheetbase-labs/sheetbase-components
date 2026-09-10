import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useIdleSave, type PersistenceAdapter } from "../persistence";
import type { ThemeMode } from "../ThemeToggle";
import {
  findStack,
  loadPaneLayoutState,
  movePane,
  paneLayoutState,
  pruneLayout,
  removePane,
  reorderStack,
  setActivePane,
  setSplitSizes,
  singleStack,
  splitPaneOut,
  type DropZone,
  type Layout,
  type LayoutNode,
  type PaneId,
  type PaneLayoutState,
  type SplitNode,
  type SplitDirection,
  type StackNode,
} from "./layout";

/** One pane the layout can place. `content` stays mounted while tabbed away. */
export interface PaneSpec {
  id: PaneId;
  /** Tab / header label. `tab` overrides it in the tab strip. */
  title: ReactNode;
  tab?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned header controls (buttons, menus). */
  actions?: ReactNode;
  content: ReactNode;
  /** Show a close button in the header and allow keyboard close; requires `onClosePane`. */
  closable?: boolean;
}

export interface PaneLayoutProps {
  panes: readonly PaneSpec[];
  /** Controlled layout tree. Omit for uncontrolled (`defaultLayout` + internal state). */
  layout?: Layout;
  /** Initial layout when uncontrolled. Defaults to one stack of every pane. */
  defaultLayout?: Layout;
  onLayoutChange?: (next: Layout) => void;
  /**
   * Persist the layout under this key via `adapter` (versioned wrapper). Saves
   * run for controlled and uncontrolled layouts; loads reconcile against
   * `panes` and apply when uncontrolled (a controlled host owns its initial
   * state — use `loadPaneLayoutState`).
   */
  persistKey?: string;
  adapter?: PersistenceAdapter<PaneLayoutState>;
  /** Called when a `closable` pane is closed (pointer or keyboard). */
  onClosePane?: (id: PaneId) => void;
  /** Resize floor in pixels applied to splitter drags. Default 140. */
  minPaneSize?: number;
  /**
   * Establishes the shared theme scope for pane chrome (splitter, tabs, drag
   * preview, drop zones). Pass the host theme when PaneLayout is not already
   * inside a `.sheetbase-scope` (e.g. a bare page or a `SheetbaseShell`).
   */
  theme?: ThemeMode;
  className?: string;
}

type Direction = "left" | "right" | "up" | "down";

interface DragState {
  paneId: PaneId;
  sourceStackId: string;
  x: number;
  y: number;
  overStackId: string | null;
  zone: DropZone | null;
  /** Index of the tab under the pointer, for same-stack reordering. */
  overTabIndex: number | null;
}

/** A component's own toolbar height; drag starts in that band. */
const TOP_BAR_PX = 40;

/** Controls keep their own pointer behaviour; only inert chrome starts a drag. */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label, th, [contenteditable='true'], [role='button'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menu'], [role='checkbox'], [role='combobox'], [role='slider'], [role='separator']";

const CAN_PORTAL = typeof document !== "undefined";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function paneLabel(pane: PaneSpec | undefined, id: PaneId): ReactNode {
  if (!pane) return id;
  return pane.tab ?? pane.title;
}

function splitFor(direction: Direction): { direction: SplitDirection; before: boolean } {
  if (direction === "left") return { direction: "row", before: true };
  if (direction === "right") return { direction: "row", before: false };
  if (direction === "up") return { direction: "column", before: true };
  return { direction: "column", before: false };
}

/**
 * A nestable multiplexer: panes tile into resizable splits and tabbed stacks.
 * Drag a pane onto another pane's edge to split, or onto its centre to tab them
 * together. Grab a tabbed pane by its tab, or a lone pane by the empty chrome
 * of its own top bar.
 *
 * Pane content is rendered through stable portals, so moving a pane between
 * stacks or tabs preserves its component state.
 *
 * Keyboard: in a tab strip, Left/Right/Home/End move and activate, Alt+Shift+Left/Right
 * reorder, Delete closes. On any focused pane, Alt+Arrow joins the nearest stack in
 * that direction, Alt+Shift+Arrow pulls the pane out into a split, Delete closes.
 */
export function PaneLayout({
  panes,
  layout: controlledLayout,
  defaultLayout,
  onLayoutChange,
  persistKey,
  adapter,
  onClosePane,
  minPaneSize = 140,
  theme,
  className,
}: PaneLayoutProps) {
  const paneMap = useMemo(() => new Map(panes.map((pane) => [pane.id, pane])), [panes]);
  const paneIds = useMemo(() => panes.map((pane) => pane.id), [panes]);
  const paneIdsKey = paneIds.join("\u0000");

  const [innerLayout, setInnerLayout] = useState<Layout>(() =>
    controlledLayout !== undefined
      ? controlledLayout
      : loadPaneLayoutState(adapter, persistKey, paneIds, defaultLayout ?? singleStack(paneIds)),
  );
  const layout = controlledLayout !== undefined ? controlledLayout : innerLayout;
  // Persist whatever is current. Controlled hosts load their own initial state.
  const state = useMemo(() => paneLayoutState(layout), [layout]);
  useIdleSave(persistKey, state, adapter);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stackRefs = useRef(new Map<string, HTMLElement>());
  const hostsRef = useRef(new Map<PaneId, HTMLDivElement>());
  const rootRef = useRef<HTMLDivElement>(null);

  // Drop panes the host no longer offers. Additions are handled at load time
  // (reconcile), never at runtime, so an intentionally closed pane stays closed.
  const lastPaneIdsRef = useRef(paneIdsKey);
  useEffect(() => {
    if (lastPaneIdsRef.current === paneIdsKey) return;
    lastPaneIdsRef.current = paneIdsKey;
    if (controlledLayout !== undefined) return;
    setInnerLayout((current) => pruneLayout(current, paneIds));
  }, [paneIdsKey, paneIds, controlledLayout]);

  // Stable DOM hosts so React keeps pane state when a pane moves between stacks.
  function hostFor(id: PaneId): HTMLDivElement | null {
    if (!CAN_PORTAL) return null;
    let host = hostsRef.current.get(id);
    if (!host) {
      host = document.createElement("div");
      host.className = "sb-pane-host";
      hostsRef.current.set(id, host);
    }
    return host;
  }

  function attachHost(slot: HTMLElement | null, id: PaneId) {
    if (!slot) return;
    const host = hostsRef.current.get(id);
    if (host && host.parentElement !== slot) slot.appendChild(host);
  }

  function commit(next: Layout) {
    if (controlledLayout === undefined) setInnerLayout(next);
    onLayoutChange?.(next);
  }

  function requestClose(paneId: PaneId, stackId: string) {
    const pane = paneMap.get(paneId);
    if (!pane?.closable || !onClosePane) return;
    commit(removePane(layout, paneId, stackId));
    onClosePane(paneId);
    setAnnouncement(`Closed ${typeof pane.tab === "string" ? pane.tab : typeof pane.title === "string" ? pane.title : paneId}`);
  }

  function registerStack(id: string, element: HTMLElement | null) {
    if (element) stackRefs.current.set(id, element);
    else stackRefs.current.delete(id);
  }

  /** Stack under the pointer plus edge zone, or the tab under it for reordering. */
  function hitTest(x: number, y: number): { stackId: string; zone: DropZone; tabIndex: number | null } | null {
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    const tab = under?.closest(".sb-pane-tab") as HTMLElement | null;
    if (tab) {
      const stackEl = tab.closest(".sb-pane-stack") as HTMLElement | null;
      const stackId = stackEl?.dataset.stackId;
      if (stackId) {
        const siblings = Array.from((tab.parentElement as HTMLElement).children);
        return { stackId, zone: "center", tabIndex: siblings.indexOf(tab) };
      }
    }
    for (const [stackId, element] of stackRefs.current) {
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const rx = (x - rect.left) / Math.max(1, rect.width);
      const ry = (y - rect.top) / Math.max(1, rect.height);
      const edge = 0.3;
      let zone: DropZone = "center";
      let nearest = edge;
      const bands: Array<[DropZone, number]> = [
        ["left", rx],
        ["right", 1 - rx],
        ["top", ry],
        ["bottom", 1 - ry],
      ];
      for (const [candidate, distance] of bands) {
        if (distance < nearest) {
          zone = candidate;
          nearest = distance;
        }
      }
      return { stackId, zone, tabIndex: null };
    }
    return null;
  }

  function beginDrag(event: ReactPointerEvent, stackId: string, paneId: PaneId) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const move = (native: PointerEvent) => {
      if (!dragging && Math.hypot(native.clientX - startX, native.clientY - startY) < 4) return;
      if (!dragging) {
        dragging = true;
        document.body.style.userSelect = "none";
      }
      const hit = hitTest(native.clientX, native.clientY);
      setDrag({
        paneId,
        sourceStackId: stackId,
        x: native.clientX,
        y: native.clientY,
        overStackId: hit?.stackId ?? null,
        zone: hit?.zone ?? null,
        overTabIndex: hit?.tabIndex ?? null,
      });
    };

    const cleanup = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };

    const up = (native: PointerEvent) => {
      cleanup();
      if (!dragging) {
        commit(setActivePane(layout, stackId, paneId));
        setDrag(null);
        return;
      }
      const hit = hitTest(native.clientX, native.clientY);
      setDrag(null);
      if (!hit) return;
      if (hit.tabIndex !== null) {
        if (hit.stackId === stackId) {
          const stack = findStack(layout, stackId);
          const hovered = stack?.panes[hit.tabIndex];
          const without = stack?.panes.filter((id) => id !== paneId) ?? [];
          const index = hovered ? without.indexOf(hovered) : -1;
          if (index >= 0) commit(reorderStack(layout, stackId, paneId, index));
        } else {
          commit(movePane(layout, paneId, hit.stackId, "center"));
        }
        return;
      }
      commit(movePane(layout, paneId, hit.stackId, hit.zone));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Portaled content does not bubble React events to `.sb-pane-body`, so the
  // top-bar drag is delegated natively from the root.
  const beginDragRef = useRef(beginDrag);
  useEffect(() => {
    beginDragRef.current = beginDrag;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const body = target.closest(".sb-pane-body") as HTMLElement | null;
      if (!body) return;
      const stackId = (body.closest(".sb-pane-stack") as HTMLElement | null)?.dataset.stackId;
      if (!stackId) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      if (event.clientY - body.getBoundingClientRect().top > TOP_BAR_PX) return;
      const paneId = body.querySelector<HTMLElement>(".sb-pane-view:not([hidden])")?.dataset.paneId;
      if (paneId) beginDragRef.current(event as unknown as ReactPointerEvent, stackId, paneId);
    };
    root.addEventListener("pointerdown", onPointerDown);
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, []);

  /** Keep two adjacent panes above the pixel floor while preserving their total. */
  function resizedSizes(split: SplitNode, index: number, next: number, minFraction: number): number[] {
    const sizes = [...split.sizes];
    let a = next;
    let b = (sizes[index + 1] ?? 0) - (next - (sizes[index] ?? 0));
    if (a < minFraction) {
      b -= minFraction - a;
      a = minFraction;
    }
    if (b < minFraction) {
      a -= minFraction - b;
      b = minFraction;
    }
    sizes[index] = a;
    sizes[index + 1] = b;
    return sizes;
  }

  function beginResize(event: ReactPointerEvent, split: SplitNode, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const horizontal = split.direction === "row";
    const length = horizontal ? rect.width : rect.height;
    if (length <= 0) return;
    const minFraction = Math.min(0.45, minPaneSize / length);
    const start = horizontal ? event.clientX : event.clientY;
    const startSize = split.sizes[index] ?? 0;

    const move = (native: PointerEvent) => {
      const delta = ((horizontal ? native.clientX : native.clientY) - start) / length;
      commit(setSplitSizes(layout, split.id, resizedSizes(split, index, startSize + delta, minFraction)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onResizerKeyDown(event: KeyboardEvent, split: SplitNode, index: number) {
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const horizontal = split.direction === "row";
    const length = horizontal ? rect.width : rect.height;
    const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
    const increase = horizontal ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    const step = (16 / Math.max(1, length)) * (event.key === decrease ? -1 : 1);
    const minFraction = Math.min(0.45, minPaneSize / Math.max(1, length));
    commit(setSplitSizes(layout, split.id, resizedSizes(split, index, (split.sizes[index] ?? 0) + step, minFraction)));
  }

  function nearestStackInDirection(fromId: string, direction: Direction): string | null {
    const from = stackRefs.current.get(fromId);
    if (!from) return null;
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const [id, element] of stackRefs.current) {
      if (id === fromId) continue;
      const rect = element.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - ax;
      const dy = rect.top + rect.height / 2 - ay;
      const forward = direction === "left" ? dx < -8 : direction === "right" ? dx > 8 : direction === "up" ? dy < -8 : dy > 8;
      if (!forward) continue;
      const distance = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  }

  function onStackKeyDown(event: KeyboardEvent, node: StackNode) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const paneId = node.active;
    const pane = paneMap.get(paneId);
    const name = typeof pane?.title === "string" ? pane.title : paneId;
    if (event.key === "Delete" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (pane?.closable && onClosePane) {
        event.preventDefault();
        requestClose(paneId, node.id);
      }
      return;
    }
    const direction: Direction | null =
      event.key === "ArrowLeft" ? "left"
      : event.key === "ArrowRight" ? "right"
      : event.key === "ArrowUp" ? "up"
      : event.key === "ArrowDown" ? "down"
      : null;
    if (!direction || !event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) {
      const { direction: axis, before } = splitFor(direction);
      const next = splitPaneOut(layout, paneId, axis, before);
      if (next !== layout) {
        commit(next);
        setAnnouncement(`Split ${name} ${direction}`);
      }
    } else {
      const targetStack = nearestStackInDirection(node.id, direction);
      if (targetStack) {
        commit(movePane(layout, paneId, targetStack, "center"));
        setAnnouncement(`Moved ${name} ${direction}`);
      }
    }
  }

  function onTabKeyDown(event: KeyboardEvent, node: StackNode, paneId: PaneId, index: number) {
    const tablist = event.currentTarget.parentElement as HTMLElement | null;
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (event.key === "Delete") {
      const pane = paneMap.get(paneId);
      if (pane?.closable && onClosePane) {
        event.preventDefault();
        requestClose(paneId, node.id);
      }
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const from = node.panes.indexOf(paneId);
      const to = Math.max(0, Math.min(node.panes.length - 1, from + (event.key === "ArrowLeft" ? -1 : 1)));
      if (to !== from) commit(reorderStack(layout, node.id, paneId, to));
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextPane = node.panes[nextIndex];
    if (nextPane) {
      commit(setActivePane(layout, node.id, nextPane));
      setAnnouncement(`${typeof paneMap.get(nextPane)?.title === "string" ? paneMap.get(nextPane)?.title : nextPane} selected`);
    }
    tabs[nextIndex]?.focus();
  }

  function renderStack(node: StackNode): ReactNode {
    const tabbed = node.panes.length > 1;
    const activePane = tabbed ? paneMap.get(node.active) ?? paneMap.get(node.panes[0]!) : paneMap.get(node.active);
    const docked = drag && drag.overStackId === node.id && drag.overTabIndex === null ? drag.zone : null;
    return (
      <div
        className={cx("sb-pane-stack", tabbed && "is-tabbed")}
        key={node.id}
        data-stack-id={node.id}
        role="group"
        aria-label={typeof activePane?.title === "string" ? activePane.title : undefined}
        tabIndex={tabbed ? -1 : 0}
        ref={(element) => registerStack(node.id, element)}
        onKeyDown={(event) => onStackKeyDown(event, node)}
      >
        {tabbed && (
          <div className="sb-pane-head">
            <div className="sb-pane-tabs" role="tablist" aria-label="Panes">
              {node.panes.map((paneId, index) => {
                const pane = paneMap.get(paneId);
                return (
                  <button
                    key={paneId}
                    type="button"
                    role="tab"
                    id={`sb-pane-tab-${node.id}-${paneId}`}
                    aria-controls={`sb-pane-panel-${node.id}-${paneId}`}
                    aria-selected={paneId === node.active}
                    tabIndex={paneId === node.active ? 0 : -1}
                    className={cx("sb-pane-tab", paneId === node.active && "active", drag?.paneId === paneId && "dragging")}
                    onPointerDown={(event) => beginDrag(event, node.id, paneId)}
                    onKeyDown={(event) => onTabKeyDown(event, node, paneId, index)}
                    onClick={(event) => {
                      // Keyboard activation only; pointer clicks are resolved on pointerup.
                      if (event.detail === 0) commit(setActivePane(layout, node.id, paneId));
                    }}
                  >
                    {pane?.icon}
                    {paneLabel(pane, paneId)}
                  </button>
                );
              })}
            </div>
            <div className="sb-pane-actions">
              {activePane?.actions}
              {activePane?.closable && onClosePane && (
                <button
                  type="button"
                  className="sb-icon-btn"
                  title="Close pane"
                  aria-label="Close pane"
                  onClick={() => requestClose(activePane.id, node.id)}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
        <div className="sb-pane-body">
          {node.panes.map((paneId) => (
            <div
              className="sb-pane-view"
              key={paneId}
              hidden={paneId !== node.active}
              data-pane-id={paneId}
              role={tabbed ? "tabpanel" : undefined}
              id={tabbed ? `sb-pane-panel-${node.id}-${paneId}` : undefined}
              aria-labelledby={tabbed ? `sb-pane-tab-${node.id}-${paneId}` : undefined}
              ref={(element) => attachHost(element, paneId)}
            >
              {CAN_PORTAL ? null : paneMap.get(paneId)?.content ?? <p className="sb-muted" style={{ padding: 14 }}>Unknown pane “{paneId}”.</p>}
            </div>
          ))}
        </div>
        {docked && <div className={cx("sb-drop-zone", `is-${docked}`)} aria-hidden="true" />}
      </div>
    );
  }

  function renderNode(node: LayoutNode): ReactNode {
    if (node.kind === "stack") return renderStack(node);
    return (
      <div className={cx("sb-split", node.direction === "row" ? "is-row" : "is-column")} key={node.id}>
        {node.children.map((child, index) => (
          <Fragment key={child.id}>
            <div className="sb-split-cell" style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 } as CSSProperties}>
              {renderNode(child)}
            </div>
            {index < node.children.length - 1 && (
              <div
                className="sb-resizer"
                role="separator"
                tabIndex={0}
                aria-label="Resize panes"
                aria-orientation={node.direction === "row" ? "vertical" : "horizontal"}
                onPointerDown={(event) => beginResize(event, node, index)}
                onKeyDown={(event) => onResizerKeyDown(event, node, index)}
              />
            )}
          </Fragment>
        ))}
      </div>
    );
  }

  const ghostPane = drag ? paneMap.get(drag.paneId) : undefined;

  return (
    <div
      className={cx("sb-panes", theme && "sheetbase-scope", className)}
      data-theme={theme}
      data-dragging={drag ? "true" : undefined}
      ref={rootRef}
    >
      {layout ? renderNode(layout) : <p className="sb-muted" style={{ padding: 14 }}>No panes.</p>}
      {CAN_PORTAL &&
        panes.map((pane) => {
          const host = hostFor(pane.id);
          return host ? createPortal(pane.content, host, pane.id) : null;
        })}
      {drag && (
        <div className="sb-pane-drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {paneLabel(ghostPane, drag.paneId)}
        </div>
      )}
      <div className="sb-pane-live" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}
