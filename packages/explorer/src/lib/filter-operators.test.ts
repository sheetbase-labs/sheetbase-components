import { describe, expect, it } from "vitest";
import { filterOperators } from "./filter-operators";

describe("filterOperators", () => {
  it("uses the shared contract for text columns including endsWith", () => {
    const ops = filterOperators("string").map(([op]) => op);
    expect(ops).toContain("endsWith");
    expect(ops).toContain("isNull");
  });

  it("uses numeric operators for number columns", () => {
    const ops = filterOperators("number").map(([op]) => op);
    expect(ops).toContain("between");
    expect(ops).not.toContain("contains");
  });
});
