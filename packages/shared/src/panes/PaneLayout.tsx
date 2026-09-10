import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { loadInitialState, useIdleSave, type PersistenceAdapter } from "../persistence";
import type { ThemeMode } from "../ThemeToggle";
import {
  movePane,
  setActivePane,
  setSplitSizes,
  singleStack,
  type DropZone,
  type Layout,
  type LayoutNode,
  type PaneId,
  type SplitNode,
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
  /** Show a close button in the header; requires `onClosePane`. */
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
   * Persist the layout under this key via `adapter`. Saves run for controlled
   * and uncontrolled layouts; loads only apply when uncontrolled (a controlled
   * host owns its initial state).
   */
  persistKey?: string;
  adapter?: PersistenceAdapter<Layout>;
  /** Called when a `closable` pane's close button is pressed. */
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

interface DragState {
  paneId: PaneId;
  x: number;
  y: number;
  overStackId: string | null;
  zone: DropZone | null;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function paneLabel(pane: PaneSpec | undefined, id: PaneId): ReactNode {
  if (!pane) return id;
  return pane.tab ?? pane.title;
}

/** Height of a component's own toolbar, dragged from its empty space. */
const TOP_BAR_PX = 40;

/** Controls keep their own pointer behaviour; only inert chrome starts a drag. */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label, th, [contenteditable='true'], [role='button'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menu'], [role='checkbox'], [role='combobox'], [role='slider'], [role='separator']";

/**
 * A nestable multiplexer: panes tile into resizable splits and tabbed stacks.
 * Drag a pane onto another pane's edge to split, or onto its centre to tab them
 * together. Grab a tabbed pane by its tab, or a lone pane by the empty chrome
 * of its own top bar. The layout tree is host-owned, so it can be persisted or
 * built programmatically.
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

  const [innerLayout, setInnerLayout] = useState<Layout>(() =>
    controlledLayout !== undefined
      ? controlledLayout
      : loadInitialState(persistKey, adapter, defaultLayout ?? singleStack(paneIds)),
  );
  const layout = controlledLayout !== undefined ? controlledLayout : innerLayout;
  // Persist whatever is current. Controlled hosts load their own initial state
  // (see the README) because the `layout` prop wins over the stored value.
  useIdleSave(persistKey, layout, adapter);

  const [drag, setDrag] = useState<DragState | null>(null);
  const stackRefs = useRef(new Map<string, HTMLElement>());

  function commit(next: Layout) {
    if (controlledLayout === undefined) setInnerLayout(next);
    onLayoutChange?.(next);
  }

  function registerStack(id: string, element: HTMLElement | null) {
    if (element) stackRefs.current.set(id, element);
    else stackRefs.current.delete(id);
  }

  /** Which stack sits under the pointer, and which edge band (if any) is nearest. */
  function hitTest(x: number, y: number): { stackId: string; zone: DropZone } | null {
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
      return { stackId, zone };
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
        x: native.clientX,
        y: native.clientY,
        overStackId: hit?.stackId ?? null,
        zone: hit?.zone ?? null,
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
      if (hit) commit(movePane(layout, paneId, hit.stackId, hit.zone));
      setDrag(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Lone panes have no tab: drag from the empty chrome of the component's own top bar. */
  function beginTopBarDrag(event: ReactPointerEvent, stackId: string, paneId: PaneId, body: HTMLElement | null) {
    if (!body) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    if (event.clientY - body.getBoundingClientRect().top > TOP_BAR_PX) return;
    beginDrag(event, stackId, paneId);
  }

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

  function renderStack(node: StackNode): ReactNode {
    const tabbed = node.panes.length > 1;
    const activePane = tabbed ? paneMap.get(node.active) ?? paneMap.get(node.panes[0]!) : paneMap.get(node.active);
    const docked = drag && drag.overStackId === node.id ? drag.zone : null;
    return (
      <div className={cx("sb-pane-stack", tabbed && "is-tabbed")} key={node.id} ref={(element) => registerStack(node.id, element)}>
        {tabbed && (
          <div className="sb-pane-head">
            <div className="sb-pane-tabs" role="tablist">
              {node.panes.map((paneId) => {
                const pane = paneMap.get(paneId);
                return (
                  <button
                    key={paneId}
                    type="button"
                    role="tab"
                    aria-selected={paneId === node.active}
                    className={cx("sb-pane-tab", paneId === node.active && "active", drag?.paneId === paneId && "dragging")}
                    onPointerDown={(event) => beginDrag(event, node.id, paneId)}
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
                  onClick={() => onClosePane(activePane.id)}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
        <div
          className="sb-pane-body"
          onPointerDown={(event) => beginTopBarDrag(event, node.id, node.active, event.currentTarget)}
        >
          {node.panes.map((paneId) => (
            <div className="sb-pane-view" key={paneId} hidden={paneId !== node.active} data-pane-id={paneId}>
              {paneMap.get(paneId)?.content ?? <p className="sb-muted" style={{ padding: 14 }}>Unknown pane “{paneId}”.</p>}
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
    >
      {layout ? renderNode(layout) : <p className="sb-muted" style={{ padding: 14 }}>No panes.</p>}
      {drag && (
        <div className="sb-pane-drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {paneLabel(ghostPane, drag.paneId)}
        </div>
      )}
    </div>
  );
}
