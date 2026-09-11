import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "../persistence";
import {
  addPaneToStack,
  containsPane,
  findStack,
  listPanes,
  listStacks,
  loadPaneLayoutState,
  makeStack,
  movePane,
  normaliseSizes,
  paneLayoutState,
  parsePaneLayoutState,
  pruneLayout,
  reconcileLayout,
  removePane,
  reorderStack,
  setActivePane,
  setSplitSizes,
  singleStack,
  splitPaneOut,
  splitStack,
  stackOf,
  type Layout,
  type LayoutNode,
  type PaneLayoutState,
  type SplitNode,
  type StackNode,
} from "./layout";

const stack = (id: string, panes: string[], active = panes[0]!): StackNode =>
  ({ kind: "stack", id, panes, active });

const split = (id: string, direction: "row" | "column", children: LayoutNode[], sizes?: number[]): SplitNode =>
  ({ kind: "split", id, direction, children, sizes: sizes ?? children.map(() => 1 / children.length) });

describe("normaliseSizes", () => {
  it("scales weights to sum one", () => {
    expect(normaliseSizes([2, 2])).toEqual([0.5, 0.5]);
    expect(normaliseSizes([1, 3])).toEqual([0.25, 0.75]);
  });

  it("falls back to equal shares when every weight is non-positive", () => {
    expect(normaliseSizes([0, 0])).toEqual([0.5, 0.5]);
    expect(normaliseSizes([-1, 0])).toEqual([0.5, 0.5]);
  });

  it("handles an empty list", () => {
    expect(normaliseSizes([])).toEqual([]);
  });
});

describe("makeStack / singleStack", () => {
  it("defaults active to the first pane", () => {
    expect(makeStack("s", ["a", "b"]).active).toBe("a");
    expect(singleStack(["a", "b"], "s")).toMatchObject({ kind: "stack", id: "s", active: "a" });
  });

  it("treats an empty stack as having an empty active id", () => {
    expect(makeStack("s", []).active).toBe("");
  });
});

describe("traversal", () => {
  const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two", "three"])]);

  it("lists stacks and panes in tree order", () => {
    expect(listStacks(layout).map((node) => node.id)).toEqual(["a", "b"]);
    expect(listPanes(layout)).toEqual(["one", "two", "three"]);
  });

  it("finds stacks and owning stack by pane", () => {
    expect(findStack(layout, "b")).toMatchObject({ id: "b" });
    expect(findStack(layout, "missing")).toBeNull();
    expect(stackOf(layout, "three")?.id).toBe("b");
    expect(containsPane(layout, "one")).toBe(true);
    expect(containsPane(layout, "nope")).toBe(false);
  });
});

describe("removePane", () => {
  it("removes a tab and keeps the stack", () => {
    const layout: Layout = stack("a", ["one", "two"]);
    expect(removePane(layout, "one")).toMatchObject({ kind: "stack", panes: ["two"], active: "two" });
  });

  it("keeps the active tab when a different pane is removed", () => {
    const layout: Layout = stack("a", ["one", "two"], "two");
    expect(removePane(layout, "one")).toMatchObject({ panes: ["two"], active: "two" });
  });

  it("drops an emptied stack and collapses a two-child split", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"])]);
    expect(removePane(layout, "one")).toMatchObject({ kind: "stack", id: "b" });
  });

  it("collapses a three-child split into a renamed two-child split", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"]), stack("c", ["three"])]);
    const next = removePane(layout, "two") as SplitNode;
    expect(next.kind).toBe("split");
    expect(next.children.map((child) => (child as StackNode).id)).toEqual(["a", "c"]);
    expect(next.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("removes only from the named stack when given", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["one", "two"])]);
    const next = removePane(layout, "one", "b") as SplitNode;
    expect((next.children[0] as StackNode).panes).toEqual(["one"]);
    expect((next.children[1] as StackNode).panes).toEqual(["two"]);
  });

  it("returns null when the last pane goes", () => {
    expect(removePane(stack("a", ["one"]), "one")).toBeNull();
  });
});

describe("addPaneToStack / setActivePane", () => {
  const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"])]);

  it("appends as the active tab", () => {
    const next = addPaneToStack(layout, "b", "three") as SplitNode;
    expect((next.children[1] as StackNode)).toMatchObject({ panes: ["two", "three"], active: "three" });
  });

  it("activating an existing tab does not duplicate it", () => {
    const next = addPaneToStack(layout, "b", "two") as SplitNode;
    expect((next.children[1] as StackNode).panes).toEqual(["two"]);
  });

  it("setActivePane ignores an unknown pane", () => {
    const next = setActivePane(stack("a", ["one"]), "a", "nope") as StackNode;
    expect(next.active).toBe("one");
  });
});

describe("splitStack", () => {
  it("places the new stack before when asked", () => {
    const next = splitStack(stack("a", ["one"]), "a", "two", "row", true, { stackId: "s2", splitId: "sp" }) as SplitNode;
    expect(next.direction).toBe("row");
    expect((next.children[0] as StackNode).id).toBe("s2");
    expect((next.children[1] as StackNode).id).toBe("a");
  });

  it("places the new stack after by default ordering", () => {
    const next = splitStack(stack("a", ["one"]), "a", "two", "column", false, { stackId: "s2", splitId: "sp" }) as SplitNode;
    expect(next.direction).toBe("column");
    expect((next.children[0] as StackNode).id).toBe("a");
    expect((next.children[1] as StackNode).id).toBe("s2");
  });
});

describe("movePane", () => {
  const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"])]);

  it("tabs a pane into another stack with center", () => {
    const next = movePane(layout, "one", "b", "center") as StackNode;
    expect(next).toMatchObject({ kind: "stack", id: "b", panes: ["two", "one"], active: "one" });
  });

  it("splits the target stack when docked on an edge", () => {
    const next = movePane(layout, "one", "b", "left", { stackId: "moved", splitId: "mv" }) as SplitNode;
    expect(next.children.map((child) => (child as StackNode).id)).toEqual(["moved", "b"]);
    expect((next.children[0] as StackNode).panes).toEqual(["one"]);
    // Source stack a is now empty and gone.
    expect(findStack(next, "a")).toBeNull();
  });

  it("docks below with a column split", () => {
    const next = movePane(layout, "one", "b", "bottom", { stackId: "moved", splitId: "mv" }) as SplitNode;
    expect(next.direction).toBe("column");
    expect((next.children[1] as StackNode).id).toBe("moved");
  });

  it("edge-docking a lone pane onto its own stack is a no-op shape", () => {
    const next = movePane(stack("a", ["one"]), "one", "a", "right", { stackId: "moved", splitId: "mv" }) as StackNode;
    expect(next).toMatchObject({ kind: "stack", id: "moved", panes: ["one"] });
  });

  it("center on the owning stack just activates", () => {
    const next = movePane(stack("a", ["one", "two"], "one"), "two", "a", "center") as StackNode;
    expect(next).toMatchObject({ panes: ["one", "two"], active: "two" });
  });

  it("ignores a stale target instead of dropping the pane", () => {
    expect(movePane(layout, "one", "gone", "center")).toEqual(layout);
  });
});

describe("setSplitSizes", () => {
  it("updates only the named split", () => {
    const layout: Layout = split("root", "row", [
      split("inner", "column", [stack("a", ["one"]), stack("b", ["two"])]),
      stack("c", ["three"]),
    ]);
    const next = setSplitSizes(layout, "inner", [0.7, 0.3]) as SplitNode;
    expect((next.children[0] as SplitNode).sizes).toEqual([0.7, 0.3]);
    expect(next.sizes).toEqual([0.5, 0.5]);
  });
});

describe("pruneLayout", () => {
  it("drops unknown panes and collapses leftovers", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"])]);
    const next = pruneLayout(layout, ["two"]);
    expect(next).toMatchObject({ kind: "stack", id: "b", panes: ["two"] });
  });

  it("returns null when nothing survives", () => {
    expect(pruneLayout(stack("a", ["one"]), [])).toBeNull();
  });
});

describe("reorderStack", () => {
  it("moves a pane forward in the tab order", () => {
    const next = reorderStack(stack("a", ["one", "two", "three"], "one"), "a", "one", 2) as StackNode;
    expect(next.panes).toEqual(["two", "three", "one"]);
    expect(next.active).toBe("one");
  });

  it("moves a pane backward in the tab order", () => {
    const next = reorderStack(stack("a", ["one", "two", "three"], "three"), "a", "three", 0) as StackNode;
    expect(next.panes).toEqual(["three", "one", "two"]);
  });

  it("ignores a pane that is not in the stack", () => {
    const before = stack("a", ["one", "two"]);
    expect(reorderStack(before, "a", "nope", 0)).toEqual(before);
  });
});

describe("splitPaneOut", () => {
  it("pulls a pane out of a multi-pane stack", () => {
    const next = splitPaneOut(stack("a", ["one", "two"], "two"), "two", "row", false, { stackId: "out", splitId: "sp" }) as SplitNode;
    expect(next.kind).toBe("split");
    expect((next.children[0] as StackNode).id).toBe("a");
    expect((next.children[0] as StackNode).panes).toEqual(["one"]);
    expect((next.children[1] as StackNode)).toMatchObject({ id: "out", panes: ["two"] });
  });

  it("is a no-op for a lone pane", () => {
    const before = stack("a", ["one"]);
    expect(splitPaneOut(before, "one", "column", true, { stackId: "out", splitId: "sp" })).toEqual(before);
  });
});

describe("pane layout persistence", () => {
  it("wraps and parses the versioned state", () => {
    const layout: Layout = stack("a", ["one"]);
    expect(paneLayoutState(layout)).toEqual({ version: 1, layout });
    expect(parsePaneLayoutState({ version: 1, layout })).toEqual({ version: 1, layout });
  });

  it("tolerates a legacy bare layout", () => {
    const layout: Layout = stack("a", ["one"]);
    expect(parsePaneLayoutState(layout)).toEqual({ version: 1, layout });
  });

  it("rejects unrecognised values", () => {
    expect(parsePaneLayoutState(undefined)).toBeUndefined();
    expect(parsePaneLayoutState(42)).toBeUndefined();
    expect(parsePaneLayoutState({ hello: "world" })).toBeUndefined();
  });

  it("rejects structurally malformed trees instead of crashing", () => {
    expect(parsePaneLayoutState({ version: 1, layout: { kind: "split", children: "oops" } })).toBeUndefined();
    expect(parsePaneLayoutState({ version: 1, layout: { kind: "stack", panes: "oops" } })).toBeUndefined();
    expect(parsePaneLayoutState({ version: 1, layout: { kind: "split", direction: "row", children: [{ kind: "stack", id: "a", panes: ["p"] }] , sizes: [1, 2] } })).toBeUndefined();
    expect(parsePaneLayoutState({ kind: "split", children: "oops" })).toBeUndefined();
    // null layout is a legal persisted value.
    expect(parsePaneLayoutState({ version: 1, layout: null })).toEqual({ version: 1, layout: null });
  });

  it("falls back on malformed persisted state without throwing", () => {
    const adapter = createMemoryAdapter<PaneLayoutState>();
    adapter.save("k", { version: 1, layout: { kind: "split", children: "oops" } } as unknown as PaneLayoutState);
    const fallback: Layout = stack("f", ["one"]);
    expect(loadPaneLayoutState(adapter, "k", ["one"], fallback)).toEqual(fallback);
  });

  it("loads, reconciles and drops unknown panes", () => {
    const adapter = createMemoryAdapter<PaneLayoutState>();
    adapter.save("k", paneLayoutState(split("root", "row", [stack("a", ["one"]), stack("b", ["gone"])])));
    const loaded = loadPaneLayoutState(adapter, "k", ["one", "two"], null);
    expect(listPanes(loaded)).toEqual(["one", "two"]);
  });

  it("falls back when nothing is stored", () => {
    const fallback: Layout = stack("x", ["one"]);
    expect(loadPaneLayoutState(createMemoryAdapter<PaneLayoutState>(), "k", ["one"], fallback)).toBe(fallback);
  });
});

describe("reconcileLayout", () => {
  it("appends panes missing from the tree to the first stack", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["two"])]);
    const next = reconcileLayout(layout, ["one", "two", "three"], null) as SplitNode;
    // First stack in tree order is "a".
    expect((next.children[0] as StackNode).panes).toEqual(["one", "three"]);
    expect((next.children[0] as StackNode).active).toBe("one");
  });

  it("drops unknown panes", () => {
    const layout: Layout = split("root", "row", [stack("a", ["one"]), stack("b", ["gone"])]);
    expect(reconcileLayout(layout, ["one"], null)).toMatchObject({ kind: "stack", id: "a" });
  });

  it("returns the fallback when the stored tree is unusable", () => {
    const fallback: Layout = stack("f", ["one"]);
    expect(reconcileLayout(null, ["one"], fallback)).toEqual(fallback);
  });
});
