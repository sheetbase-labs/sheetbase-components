import { describe, expect, it } from "vitest";
import { EDGE_GAP, edgePath, nudgeNodePosition } from "./SchemaEditor";

describe("nudgeNodePosition", () => {
  it("nudges eight canvas units per arrow key", () => {
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowLeft")).toEqual({ x: 92, y: 50 });
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowRight")).toEqual({ x: 108, y: 50 });
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowUp")).toEqual({ x: 100, y: 42 });
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowDown")).toEqual({ x: 100, y: 58 });
  });

  it("widens the step to 32 units with Shift", () => {
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowRight", true)).toEqual({ x: 132, y: 50 });
    expect(nudgeNodePosition({ x: 100, y: 50 }, "ArrowUp", true)).toEqual({ x: 100, y: 18 });
  });

  it("ignores non-arrow keys", () => {
    expect(nudgeNodePosition({ x: 100, y: 50 }, "Enter")).toBeNull();
    expect(nudgeNodePosition({ x: 100, y: 50 }, "a")).toBeNull();
  });
});

describe("edgePath", () => {
  it("leaves room for the arrowhead before the target's near edge", () => {
    const forward = edgePath({ x: 0, y: 0 }, { x: 400, y: 0 }, 100);
    expect(forward.startsWith("M 232 42")).toBe(true);
    expect(forward.endsWith(`${400 - EDGE_GAP} 42`)).toBe(true);
  });

  it("connects to the right edge when the target sits to the left", () => {
    const backward = edgePath({ x: 400, y: 0 }, { x: 0, y: 0 }, 100);
    expect(backward.startsWith("M 400 42")).toBe(true);
    expect(backward.endsWith(`${232 + EDGE_GAP} 42`)).toBe(true);
  });

  it("staggers parallel entries and clamps them inside the target", () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 400, y: 0 }, 100, 14).endsWith(`${400 - EDGE_GAP} 56`)).toBe(true);
    expect(edgePath({ x: 0, y: 0 }, { x: 400, y: 0 }, 48, 100).endsWith(`${400 - EDGE_GAP} 38`)).toBe(true);
  });
});
