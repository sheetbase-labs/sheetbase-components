import { describe, expect, it } from "vitest";
import { getRelations, sheetbaseFieldsOf, validateGraph, withAutoLayout } from "./graph";
import type { SchemaGraph } from "./types";

const graph: SchemaGraph = {
  models: [
    { name: "customer", fields: [{ key: "id", type: "text", primaryKey: true }, { key: "name", type: "text" }] },
    { name: "order", fields: [{ key: "id", type: "text", primaryKey: true }, { key: "customer_id", type: "relationship", references: { model: "customer" } }] },
  ],
};

describe("getRelations", () => {
  it("extracts FK edges with primary-key default", () => {
    expect(getRelations(graph)).toEqual([
      { id: "order.customer_id->customer.id", fromModel: "order", fromField: "customer_id", toModel: "customer", toField: "id" },
    ]);
  });

  it("skips dangling references", () => {
    const dangling: SchemaGraph = { models: [{ name: "a", fields: [{ key: "x", type: "relationship", references: { model: "ghost" } }] }] };
    expect(getRelations(dangling)).toEqual([]);
  });
});

describe("validateGraph", () => {
  it("flags duplicates and dangling refs", () => {
    const bad: SchemaGraph = {
      models: [
        { name: "a", fields: [{ key: "id", type: "text" }, { key: "id", type: "text" }] },
        { name: "a", fields: [] },
        { name: "b", fields: [{ key: "x", type: "relationship", references: { model: "ghost" } }] },
      ],
    };
    const errors = validateGraph(bad);
    expect(errors.some((e) => e.includes("twice"))).toBe(true);
    expect(errors.some((e) => e.includes("Duplicate model"))).toBe(true);
    expect(errors.some((e) => e.includes("ghost"))).toBe(true);
  });
});

describe("withAutoLayout", () => {
  it("assigns positions without mutating input", () => {
    const laid = withAutoLayout(graph);
    expect(laid.models.every((m) => m.position)).toBe(true);
    expect(graph.models.every((m) => !m.position)).toBe(true);
  });
});

describe("sheetbaseFieldsOf", () => {
  it("normalises schema fields onto the shared contract", () => {
    expect(sheetbaseFieldsOf(graph.models[0]!).map((f) => f.dataType)).toEqual(["text", "text"]);
  });
});
