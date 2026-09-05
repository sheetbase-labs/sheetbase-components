import { describe, expect, it } from "vitest";
import { SpillStore } from "./spill-store";

describe("SpillStore", () => {
  it("owns and atomically replaces a dynamic range", () => {
    const spills = new SpillStore();
    expect([...spills.write("B2", [[1, 2], [3, 4]], () => false)]).toEqual([
      ["B2", 1], ["C2", 2], ["B3", 3], ["C3", 4],
    ]);
    expect(spills.owner("C3")).toBe("B2");
    spills.write("B2", [[9]], () => false);
    expect(spills.owner("C3")).toBeUndefined();
    expect(spills.value("B2")).toBe(9);
  });

  it("rejects collisions without damaging the previous spill", () => {
    const spills = new SpillStore();
    spills.write("A1", [[1], [2]], () => false);
    expect(() => spills.write("A1", [[3, 4]], (address) => address === "B1")).toThrow("#SPILL!");
    expect(spills.value("A2")).toBe(2);
  });

  it("returns owned addresses for one anchor, [] when none", () => {
    const spills = new SpillStore();
    expect(spills.range("B2")).toEqual([]);
    spills.write("B2", [[1, 2], [3, 4]], () => false);
    expect(spills.range("B2")).toEqual(["B2", "C2", "B3", "C3"]);
    expect(spills.range("C3")).toEqual([]);
    spills.clearAnchor("B2");
    expect(spills.range("B2")).toEqual([]);
  });
});
