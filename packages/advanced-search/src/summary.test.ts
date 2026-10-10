import { describe, expect, it } from "vitest";
import { countLabel, treeSummary } from "./summary";

describe("tree summary", () => {
  it("agrees nouns with their counts", () => {
    expect(countLabel(0, "condition")).toBe("0 conditions");
    expect(countLabel(1, "condition")).toBe("1 condition");
    expect(countLabel(2, "group")).toBe("2 groups");
    expect(countLabel(1_200, "row")).toBe(`${(1_200).toLocaleString()} rows`);
  });

  it("names the query shape", () => {
    expect(treeSummary(1, 1, true)).toBe("1 condition · 1 group · flat query");
    expect(treeSummary(3, 2, false)).toBe("3 conditions · 2 groups · tree query");
  });
});
