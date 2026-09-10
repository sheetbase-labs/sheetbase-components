/**
 * Pane layout model — a serializable tree of split nodes and tabbed stacks.
 *
 * The tree is host-owned data (JSON), so layouts persist like any other
 * sheetbase state. Every operation is pure and returns a new tree; React lives
 * in `PaneLayout.tsx`. This is the multiplexer core: panes can be tabbed into a
 * stack or docked beside, above or below any other stack.
 */

export type PaneId = string;

/** `row` splits side by side (left/right); `column` stacks vertically (top/bottom). */
export type SplitDirection = "row" | "column";

/** Dock intent when a pane is dropped on a stack. `center` tabs into the stack. */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

/** A leaf holding one or more tabbed panes. `active` is the visible pane. */
export interface StackNode {
  kind: "stack";
  id: string;
  panes: readonly PaneId[];
  active: PaneId;
}

/** An interior node dividing space between two or more children. */
export interface SplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  children: readonly LayoutNode[];
  /** Relative weights, parallel to `children`. Normalised to sum 1 on edit. */
  sizes: readonly number[];
}

export type LayoutNode = StackNode | SplitNode;
export type Layout = LayoutNode | null;

let counter = 0;

/** Ids for generated split/stack nodes. Stable within a session; tests can reset. */
export function createLayoutId(prefix = "node"): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Reset the generated-id counter. Test helper; production never needs it. */
export function resetLayoutIds(): void {
  counter = 0;
}

export function isStack(node: LayoutNode): node is StackNode {
  return node.kind === "stack";
}

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.kind === "split";
}

/** Scale positive weights to sum 1. Falls back to equal shares when all are non-positive. */
export function normaliseSizes(sizes: readonly number[]): number[] {
  const safe = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = safe.reduce((sum, size) => sum + size, 0);
  if (safe.length === 0) return [];
  if (total <= 0) return safe.map(() => 1 / safe.length);
  return safe.map((size) => size / total);
}

export function makeStack(id: string, panes: readonly PaneId[], active?: PaneId): StackNode {
  const list = [...panes];
  return {
    kind: "stack",
    id,
    panes: list,
    active: active && list.includes(active) ? active : list[0] ?? "",
  };
}

/** A single stack holding every pane in order — the default when no layout is given. */
export function singleStack(panes: readonly PaneId[], stackId: string = createLayoutId("stack")): StackNode {
  return makeStack(stackId, panes);
}

export function listStacks(layout: Layout): StackNode[] {
  if (!layout) return [];
  if (isStack(layout)) return [layout];
  return layout.children.flatMap(listStacks);
}

export function listPanes(layout: Layout): PaneId[] {
  return listStacks(layout).flatMap((stack) => [...stack.panes]);
}

export function findStack(layout: Layout, stackId: string): StackNode | null {
  if (!layout) return null;
  if (isStack(layout)) return layout.id === stackId ? layout : null;
  for (const child of layout.children) {
    const found = findStack(child, stackId);
    if (found) return found;
  }
  return null;
}

export function stackOf(layout: Layout, paneId: PaneId): StackNode | null {
  if (!layout) return null;
  if (isStack(layout)) return layout.panes.includes(paneId) ? layout : null;
  for (const child of layout.children) {
    const found = stackOf(child, paneId);
    if (found) return found;
  }
  return null;
}

export function containsPane(layout: Layout, paneId: PaneId): boolean {
  return stackOf(layout, paneId) !== null;
}

/** Replace the stack with `stackId` (wherever it sits) using `make`. No-op if absent. */
export function replaceStack(
  layout: Layout,
  stackId: string,
  make: (stack: StackNode) => LayoutNode,
): Layout {
  if (!layout) return layout;
  if (isStack(layout)) return layout.id === stackId ? make(layout) : layout;
  return {
    ...layout,
    children: layout.children.map((child) => replaceStack(child, stackId, make) ?? child),
  };
}

/**
 * Remove a pane. When `fromStackId` is given only that stack is touched, so a
 * pane that has just been duplicated into a new stack is not removed twice.
 * Empty stacks are dropped and single-child splits collapse to their survivor.
 */
export function removePane(layout: Layout, paneId: PaneId, fromStackId?: string): Layout {
  if (!layout) return null;
  if (isStack(layout)) {
    if (fromStackId !== undefined && layout.id !== fromStackId) return layout;
    if (!layout.panes.includes(paneId)) return layout;
    const panes = layout.panes.filter((id) => id !== paneId);
    if (panes.length === 0) return null;
    return { ...layout, panes, active: layout.active === paneId ? panes[0]! : layout.active };
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  layout.children.forEach((child, index) => {
    const next = removePane(child, paneId, fromStackId);
    if (next) {
      children.push(next);
      sizes.push(layout.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return { ...layout, children, sizes: normaliseSizes(sizes) };
}

/** Add a pane to a stack as the active tab. No-op when the stack is gone. */
export function addPaneToStack(layout: Layout, stackId: string, paneId: PaneId): Layout {
  return replaceStack(layout, stackId, (stack) => {
    if (stack.panes.includes(paneId)) return { ...stack, active: paneId };
    return { ...stack, panes: [...stack.panes, paneId], active: paneId };
  });
}

export function setActivePane(layout: Layout, stackId: string, paneId: PaneId): Layout {
  return replaceStack(layout, stackId, (stack) =>
    stack.panes.includes(paneId) ? { ...stack, active: paneId } : stack,
  );
}

/** Split a stack, placing a new single-pane stack before or after it. */
export function splitStack(
  layout: Layout,
  stackId: string,
  newPaneId: PaneId,
  direction: SplitDirection,
  before: boolean,
  ids: { stackId?: string; splitId?: string } = {},
): Layout {
  const newStack = makeStack(ids.stackId ?? createLayoutId("stack"), [newPaneId]);
  return replaceStack(layout, stackId, (stack) => ({
    kind: "split",
    id: ids.splitId ?? createLayoutId("split"),
    direction,
    children: before ? [newStack, stack] : [stack, newStack],
    sizes: [0.5, 0.5],
  }));
}

export function setSplitSizes(layout: Layout, splitId: string, sizes: readonly number[]): Layout {
  if (!layout) return null;
  if (isStack(layout)) return layout;
  if (layout.id === splitId) {
    return { ...layout, sizes: sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0)) };
  }
  return { ...layout, children: layout.children.map((child) => setSplitSizes(child, splitId, sizes) ?? child) };
}

export function zoneDirection(zone: DropZone): SplitDirection {
  return zone === "left" || zone === "right" ? "row" : "column";
}

export function zoneBefore(zone: DropZone): boolean {
  return zone === "left" || zone === "top";
}

/**
 * Move `paneId` onto `targetStackId`:
 * - `center` tabs it into the target stack;
 * - an edge splits the target stack and docks the pane on that side.
 * Stale targets (stack already gone) are ignored so a pane is never lost.
 */
export function movePane(
  layout: Layout,
  paneId: PaneId,
  targetStackId: string,
  zone: DropZone,
  ids: { stackId?: string; splitId?: string } = {},
): Layout {
  const source = stackOf(layout, paneId);
  if (!source) return layout;
  if (!findStack(layout, targetStackId)) return layout;
  if (zone === "center") {
    if (source.id === targetStackId) return setActivePane(layout, targetStackId, paneId);
    return addPaneToStack(removePane(layout, paneId, source.id), targetStackId, paneId);
  }
  const next = splitStack(layout, targetStackId, paneId, zoneDirection(zone), zoneBefore(zone), ids);
  let pruned = removePane(next, paneId, targetStackId);
  if (source.id !== targetStackId) pruned = removePane(pruned, paneId, source.id);
  return pruned;
}

/** Drop panes not present in `paneIds`, collapsing empty stacks and splits. */
export function pruneLayout(layout: Layout, paneIds: Iterable<PaneId>): Layout {
  if (!layout) return null;
  const allowed = new Set(paneIds);
  const walk = (node: LayoutNode): LayoutNode | null => {
    if (isStack(node)) {
      const panes = node.panes.filter((id) => allowed.has(id));
      if (panes.length === 0) return null;
      return { ...node, panes, active: panes.includes(node.active) ? node.active : panes[0]! };
    }
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
      const next = walk(child);
      if (next) {
        children.push(next);
        sizes.push(node.sizes[index] ?? 1);
      }
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { ...node, children, sizes: normaliseSizes(sizes) };
  };
  return walk(layout);
}
