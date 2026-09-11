import { describe, expect, it } from "vitest";
import { nudgeNodePosition } from "./SchemaEditor";

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
