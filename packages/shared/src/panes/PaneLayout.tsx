import {
  Fragment,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import "./panes.css";
import { useIdleSave, type PersistenceAdapter } from "../persistence";
import { useResolvedTheme, type ThemeMode } from "../ThemeToggle";
import {
  addPaneToStack,
  listStacks,
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
  stackOf,
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
  /**
   * Pane body. A function receives `{ tabbed }` so a component can hide its own
   * top bar while grouped (the tab strip then carries the actions).
   */
  content: ReactNode | ((context: { tabbed: boolean }) => ReactNode);
  /** Show a close button in the header and allow keyboard close; requires `onClosePane`. */
  closable?: boolean;
  /**
   * Where a pointer drag begins for this pane: its component top bar (default),
   * an inner `.sb-panel-heading`, or nowhere (`false`).
   */
  dragHandle?: "topbar" | "heading" | false;
}

/** Imperative actions for hosts driving the layout outside its UI. */
export interface PaneLayoutHandle {
  getLayout(): Layout;
  setLayout(next: Layout): void;
  /** Tab an existing pane into a stack. */
  tabInto(paneId: PaneId, targetStackId: string): void;
  /** Move a pane onto a stack location (centre tabs, edges split). */
  movePane(paneId: PaneId, targetStackId: string, zone?: DropZone): void;
  /** Place a pane the host just added to `panes` into a stack. */
  addPane(paneId: PaneId, stackId: string): void;
  /** Pull a tab out into its own pane, docked after its stack (`row` = right, `column` = below). */
  splitOut(paneId: PaneId, direction?: SplitDirection): void;
  /** Show a pane's tab. */
  activate(paneId: PaneId): void;
  /** Remove a pane from the layout and notify `onClosePane`. */
  close(paneId: PaneId): void;
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
  /**
   * `"component"` (default): each pane's component frame is its own app surface.
   * `"shared"`: neutralise nested app frames so one host surface wraps every
   * pane — components contribute only their inner panels.
   */
  surface?: "component" | "shared";
  theme?: ThemeMode;
  className?: string;
  /** Exposes imperative layout actions. */
  ref?: Ref<PaneLayoutHandle>;
  /**
   * Pane actions menu: `"head"` where a pane header exists (default), `"hover"`
   * adds a hover control for lone panes, `"off"` disables it.
   */
  paneMenu?: "head" | "hover" | "off";
  /** Host hook for the menu's "New pane…" item; receives the target stack id. */
  onRequestNewPane?: (targetStackId: string) => void;
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

/** Per-pane actions: tab this pane into another stack, add a new pane, close. */
function PaneMenu({ stackId, theme, otherStacks, closable, canSplit, onTabInto, onRequestNewPane, onSplitOut, onClose }: {
  stackId: string;
  theme?: ThemeMode;
  otherStacks: ReadonlyArray<{ id: string; label: ReactNode }>;
  closable: boolean;
  canSplit: boolean;
  onTabInto(stackId: string): void;
  onRequestNewPane?(stackId: string): void;
  onSplitOut(): void;
  onClose(): void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const resolvedTheme = useResolvedTheme(theme ?? "light");

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const openUp = rect.bottom + 180 > window.innerHeight;
      setPosition({ top: openUp ? Math.max(8, rect.top - 180) : rect.bottom + 4, left: Math.max(8, rect.right - 180) });
    }
    setOpen((value) => !value);
  }

  return (
    <div className="sb-pane-menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="sb-icon-btn sb-pane-menu-btn"
        aria-label="Pane actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && CAN_PORTAL && createPortal(
        <>
          <button type="button" className="sb-pane-menu-backdrop" aria-label="Close pane menu" onClick={() => setOpen(false)} />
          <div className="sheetbase-scope sb-pane-menu" role="menu" data-theme={theme === undefined ? undefined : resolvedTheme} style={{ top: position.top, left: position.left }}>
            {otherStacks.length > 0 && <p className="sb-pane-menu-label">Tab with</p>}
            {otherStacks.map((stack) => (
              <button key={stack.id} type="button" role="menuitem" onClick={() => { onTabInto(stack.id); setOpen(false); }}>
                {stack.label}
              </button>
            ))}
            {onRequestNewPane && (
              <button type="button" role="menuitem" onClick={() => { onRequestNewPane(stackId); setOpen(false); }}>New pane…</button>
            )}
            {canSplit && (
              <button type="button" role="menuitem" onClick={() => { onSplitOut(); setOpen(false); }}>Split into pane</button>
            )}
            {closable && (
              <button type="button" role="menuitem" onClick={() => { onClose(); setOpen(false); }}>Close pane</button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
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
  surface = "component",
  theme,
  className,
  ref,
  paneMenu = "head",
  onRequestNewPane,
}: PaneLayoutProps) {
  const resolvedTheme = useResolvedTheme(theme ?? "light");
  const paneMap = useMemo(() => new Map(panes.map((pane) => [pane.id, pane])), [panes]);
  const paneIds = useMemo(() => panes.map((pane) => pane.id), [panes]);
  const paneIdsKey = paneIds.join("\u0000");
  // Deterministic per-instance id so the default stack is stable across a
  // server render and hydration; interactive nodes get generated ids later.
  const instanceId = useId();

  const [innerLayout, setInnerLayout] = useState<Layout>(() =>
    controlledLayout !== undefined
      ? controlledLayout
      : loadPaneLayoutState(adapter, persistKey, paneIds, defaultLayout ?? singleStack(paneIds, `sb-${instanceId}`)),
  );
  const rawLayout = controlledLayout !== undefined ? controlledLayout : innerLayout;
  // Always drop panes the host no longer offers — controlled or not. Additions
  // are handled at load time (reconcile), so a closed pane stays closed.
  const layout = useMemo(() => pruneLayout(rawLayout, paneIds), [rawLayout, paneIdsKey]);
  // Which panes are currently grouped, so content can hide its own top bar.
  const tabbedByPane = useMemo(() => {
    const map = new Map<PaneId, boolean>();
    for (const stack of listStacks(layout)) {
      for (const id of stack.panes) map.set(id, stack.panes.length > 1);
    }
    return map;
  }, [layout]);
  // Persist whatever is current. Controlled hosts load their own initial state.
  const state = useMemo(() => paneLayoutState(layout), [layout]);
  useIdleSave(persistKey, state, adapter);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stackRefs = useRef(new Map<string, HTMLElement>());
  const stackRectsRef = useRef(new Map<string, DOMRect>());
  const hostsRef = useRef(new Map<PaneId, HTMLDivElement>());
  const rootRef = useRef<HTMLDivElement>(null);

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
    const rects = stackRectsRef.current.size > 0
      ? stackRectsRef.current
      : new Map([...stackRefs.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
    for (const [stackId, rect] of rects) {
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
    // Not over a pane (e.g. a splitter gutter): fall back to the nearest stack
    // so a drop never silently does nothing.
    const root = rootRef.current?.getBoundingClientRect();
    if (root && x >= root.left && x <= root.right && y >= root.top && y <= root.bottom) {
      let nearestId: string | null = null;
      let nearestDistance = Infinity;
      for (const [stackId, rect] of rects) {
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = stackId;
        }
      }
      if (nearestId) return { stackId: nearestId, zone: "center", tabIndex: null };
    }
    return null;
  }

  function beginDrag(event: ReactPointerEvent, stackId: string, paneId: PaneId) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const previousUserSelect = document.body.style.userSelect;
    // Stacks do not move during a drag, so snapshot their rects once instead of
    // measuring every stack on every pointer move.
    stackRectsRef.current = new Map([...stackRefs.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
    // Standard docking: a drop on a tab/tab strip joins that group (or reorders
    // within it); a drop on a pane body splits (centre docks right); a drop on
    // its own pane body pops it out.
    type DropAction =
      | { kind: "tab"; stackId: string }
      | { kind: "split"; stackId: string; zone: DropZone }
      | { kind: "pop" };
    const resolveDrop = (hit: { stackId: string; zone: DropZone; tabIndex: number | null } | null): DropAction | null => {
      if (!hit) return null;
      // Within its own group, a drop always pops the pane out — never a no-op
      // reorder that leaves it looking stuck as a tab.
      if (hit.stackId === stackId) return { kind: "pop" };
      if (hit.tabIndex !== null) return { kind: "tab", stackId: hit.stackId };
      return { kind: "split", stackId: hit.stackId, zone: hit.zone === "center" ? "right" : hit.zone };
    };
    const preview = (drop: DropAction | null): { overStackId: string | null; zone: DropZone | null } => {
      if (drop?.kind === "tab") return { overStackId: drop.stackId, zone: "center" };
      if (drop?.kind === "split") return { overStackId: drop.stackId, zone: drop.zone };
      if (drop?.kind === "pop") return { overStackId: stackId, zone: "right" };
      return { overStackId: null, zone: null };
    };
    let dragging = false;

    const move = (native: PointerEvent) => {
      if (!dragging && Math.hypot(native.clientX - startX, native.clientY - startY) < 4) return;
      if (!dragging) {
        dragging = true;
        document.body.style.userSelect = "none";
      }
      const { overStackId, zone } = preview(resolveDrop(hitTest(native.clientX, native.clientY)));
      setDrag({ paneId, sourceStackId: stackId, x: native.clientX, y: native.clientY, overStackId, zone, overTabIndex: null });
    };

    const cleanup = () => {
      document.body.style.userSelect = previousUserSelect;
      stackRectsRef.current.clear();
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
      const drop = resolveDrop(hitTest(native.clientX, native.clientY));
      setDrag(null);
      if (!drop) return;
      if (drop.kind === "tab") {
        commit(movePane(layout, paneId, drop.stackId, "center"));
        return;
      }
      if (drop.kind === "pop") {
        const next = splitPaneOut(layout, paneId, "row", false);
        if (next !== layout) commit(next);
        return;
      }
      commit(movePane(layout, paneId, drop.stackId, drop.zone));
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
      // Only own stacks: a nested PaneLayout handles its own events first.
      if (!stackId || !stackRefs.current.has(stackId)) return;
      const view = body.querySelector<HTMLElement>(".sb-pane-view:not([hidden])");
      const paneId = view?.dataset.paneId;
      if (!paneId) return;
      const handle = view?.dataset.dragHandle;
      if (handle === "false") return;
      const inHead = Boolean(target.closest(".sb-pane-head"));
      if (!inHead && (handle === "heading" ? !target.closest(".sb-panel-heading") : event.clientY - body.getBoundingClientRect().top > TOP_BAR_PX)) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      beginDragRef.current(event as unknown as ReactPointerEvent, stackId, paneId);
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
    if (event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const next = splitPaneOut(layout, paneId, "column", event.key === "ArrowUp");
      if (next !== layout) {
        commit(next);
        setAnnouncement(`Split ${typeof paneMap.get(paneId)?.title === "string" ? paneMap.get(paneId)?.title : paneId} ${event.key === "ArrowUp" ? "up" : "down"}`);
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

  function renderContent(paneId: PaneId, tabbed: boolean): ReactNode {
    const pane = paneMap.get(paneId);
    if (!pane) return <p className="sb-muted" style={{ padding: 14 }}>Unknown pane “{paneId}”.</p>;
    return typeof pane.content === "function" ? pane.content({ tabbed }) : pane.content;
  }

  function renderStack(node: StackNode): ReactNode {
    const tabbed = node.panes.length > 1;
    const activePane = tabbed ? paneMap.get(node.active) ?? paneMap.get(node.panes[0]!) : paneMap.get(node.active);
    // The tab strip is multiplexer chrome on the stack background; every
    // component keeps its own plate and top bar underneath it.
    const showHead = tabbed;
    const docked = drag && drag.overStackId === node.id && drag.overTabIndex === null ? drag.zone : null;
    const otherStacks = listStacks(layout)
      .filter((stack) => stack.id !== node.id)
      .map((stack) => ({ id: stack.id, label: paneLabel(paneMap.get(stack.active), stack.active) }));
    const menu = paneMenu === "off" ? null : (
      <PaneMenu
        stackId={node.id}
        theme={theme}
        otherStacks={otherStacks}
        closable={Boolean(activePane?.closable && onClosePane)}
        canSplit={node.panes.length > 1}
        onTabInto={(target) => commit(movePane(layout, node.active, target, "center"))}
        onRequestNewPane={onRequestNewPane}
        onSplitOut={() => commit(splitPaneOut(layout, node.active, "row", false))}
        onClose={() => { if (activePane) requestClose(activePane.id, node.id); }}
      />
    );
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
        {showHead && (
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
              {menu}
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
        {!showHead && paneMenu === "hover" && menu && <div className="sb-pane-fab">{menu}</div>}
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
              data-drag-handle={paneMap.get(paneId)?.dragHandle === undefined ? undefined : String(paneMap.get(paneId)?.dragHandle)}
              ref={(element) => attachHost(element, paneId)}
            >
              {CAN_PORTAL ? null : renderContent(paneId, tabbed)}
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

  useImperativeHandle(ref, () => ({
    getLayout: () => layout,
    setLayout: (next: Layout) => commit(next),
    tabInto: (paneId: PaneId, targetStackId: string) => commit(movePane(layout, paneId, targetStackId, "center")),
    movePane: (paneId: PaneId, targetStackId: string, zone: DropZone = "center") => commit(movePane(layout, paneId, targetStackId, zone)),
    addPane: (paneId: PaneId, stackId: string) => commit(addPaneToStack(layout, stackId, paneId)),
    splitOut: (paneId: PaneId, direction: SplitDirection = "row") => commit(splitPaneOut(layout, paneId, direction, false)),
    activate: (paneId: PaneId) => {
      const stack = stackOf(layout, paneId);
      if (stack) commit(setActivePane(layout, stack.id, paneId));
    },
    close: (paneId: PaneId) => {
      const stack = stackOf(layout, paneId);
      if (!stack) return;
      commit(removePane(layout, paneId, stack.id));
      onClosePane?.(paneId);
    },
  }));

  return (
    <div
      className={cx("sb-panes", surface === "shared" && "sb-panes--shared", theme && "sheetbase-scope", className)}
      data-theme={theme === undefined ? undefined : resolvedTheme}
      data-dragging={drag ? "true" : undefined}
      ref={rootRef}
    >
      {layout ? renderNode(layout) : <p className="sb-muted" style={{ padding: 14 }}>No panes.</p>}
      {CAN_PORTAL &&
        panes.map((pane) => {
          const host = hostFor(pane.id);
          return host ? createPortal(renderContent(pane.id, tabbedByPane.get(pane.id) ?? false), host, pane.id) : null;
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
