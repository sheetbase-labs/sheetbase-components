import { describe, expect, it } from "vitest";
import { fitTransform, getRelations, rewriteReferences, sheetbaseFieldsOf, tableHeaderFields, validateGraph, withAutoLayout } from "./graph";
import type { SchemaGraph } from "./types";

const graph: SchemaGraph = {
  models: [
    { name: "customer", fields: [{ key: "id", type: "text", primaryKey: true }, { key: "name", type: "text" }] },
    { name: "order", fields: [{ key: "id", type: "text", primaryKey: true }, { key: "customer_id", type: "relationship", references: { model: "customer" } }] },
  ],
};

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a defined value");
  return value;
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

  it("flags references to a missing field on an existing model", () => {
    const danglingField: SchemaGraph = {
      models: [
        { name: "customer", fields: [{ key: "id", type: "text", primaryKey: true }] },
        { name: "order", fields: [{ key: "customer_id", type: "relationship", references: { model: "customer", field: "uuid" } }] },
      ],
    };
    expect(validateGraph(danglingField)).toEqual(['order.customer_id references missing field "uuid" on "customer".']);
  });

  it("accepts model-level references without a field target", () => {
    expect(validateGraph(graph)).toEqual([]);
    const toPk: SchemaGraph = {
      models: [
        { name: "customer", fields: [{ key: "id", type: "text", primaryKey: true }] },
        { name: "order", fields: [{ key: "customer_id", type: "relationship", references: { model: "customer", field: "id" } }] },
      ],
    };
    expect(validateGraph(toPk)).toEqual([]);
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
    expect(sheetbaseFieldsOf(must(graph.models[0])).map((f) => f.dataType)).toEqual(["text", "text"]);
  });
});

describe("rewriteReferences", () => {
  it("rewrites FK model names when a model is renamed", () => {
    const next = rewriteReferences(
      { models: graph.models.map((m) => (m.name === "customer" ? { ...m, name: "client" } : m)) },
      { kind: "rename-model", from: "customer", to: "client" },
    );
    expect(next.models.find((m) => m.name === "order")?.fields[1]?.references).toEqual({ model: "client" });
  });

  it("clears FKs when a model is deleted", () => {
    const next = rewriteReferences(
      { models: graph.models.filter((m) => m.name !== "customer") },
      { kind: "delete-model", name: "customer" },
    );
    expect(next.models[0]?.fields.find((f) => f.key === "customer_id")?.references).toBeUndefined();
  });
});

describe("tableHeaderFields", () => {
  it("assigns column indices for DatasetHeader", () => {
    expect(tableHeaderFields(must(graph.models[1])).map((f) => [f.id, f.column, f.dataType])).toEqual([
      ["id", 0, "text"],
      ["customer_id", 1, "relationship"],
    ]);
  });
});

describe("fitTransform", () => {
  it("scales zoom to fit the viewport", () => {
    const view = fitTransform({ x: 0, y: 0, w: 800, h: 400 }, 400, 400, 0);
    expect(view.zoom).toBe(0.5);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });
});
