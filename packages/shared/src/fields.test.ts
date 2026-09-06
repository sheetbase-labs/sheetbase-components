import { describe, expect, it } from "vitest";
import { fieldFromColumn, fieldFromSchema, toColumnKind, toFieldDataType } from "./fields";

describe("toFieldDataType", () => {
  it("maps legacy names onto the canonical vocabulary", () => {
    expect(toFieldDataType("string")).toBe("text");
    expect(toFieldDataType("relation")).toBe("relationship");
    expect(toFieldDataType("text")).toBe("text");
    expect(toFieldDataType("datetime")).toBe("datetime");
    expect(toFieldDataType("mystery")).toBe("text");
  });

  it("round-trips explorer column kinds", () => {
    expect(toColumnKind("text")).toBe("string");
    expect(toColumnKind("relationship")).toBe("string");
    expect(fieldFromColumn({ key: "status", kind: "string" })).toMatchObject({ id: "status", dataType: "text" });
    expect(fieldFromSchema({ key: "customer_id", type: "relation", references: { model: "customer" } })).toMatchObject({
      id: "customer_id",
      dataType: "relationship",
      references: { model: "customer" },
    });
  });
});
