import { describe, expect, it } from "vitest";
import { queryKey } from "./query";

describe("queryKey", () => {
  it("creates stable identities while preserving clause priority", () => {
    const first = queryKey({ sort: [{ fieldId: "date", direction: "desc" }], filters: [{ fieldId: "status", operator: "eq", value: "Complete" }] });
    const second = queryKey({ filters: [{ value: "Complete", operator: "eq", fieldId: "status" }], sort: [{ direction: "desc", fieldId: "date" }] });
    expect(first).toBe(second);
    expect(first).not.toBe(queryKey({ sort: [{ fieldId: "date", direction: "asc" }] }));
  });

  it("includes AND/OR filter logic in the cache identity", () => {
    const filters = [{ fieldId: "status", operator: "eq" as const, value: "Review" }];
    expect(queryKey({ filters, filterLogic: "and" })).not.toBe(queryKey({ filters, filterLogic: "or" }));
  });
});
