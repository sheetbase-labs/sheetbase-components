import { describe, expect, it } from "vitest";
import { CellStore } from "./cell-store";

describe("CellStore", () => {
  it("applies and reverses sparse overlays without changing its parent", () => {
    const root = CellStore.from(new Map([["A1", "one"], ["B1", "two"]]));
    const changes = [
      { address: "A1", before: "one", after: "changed" },
      { address: "B1", before: "two", after: undefined },
      { address: "C1", before: undefined, after: "new" },
    ];
    const edited = root.apply(changes);
    expect([...edited]).toEqual([["A1", "changed"], ["C1", "new"]]);
    expect([...root]).toEqual([["A1", "one"], ["B1", "two"]]);
    expect([...edited.apply(changes, "backward")]).toEqual([...root]);
  });
});
