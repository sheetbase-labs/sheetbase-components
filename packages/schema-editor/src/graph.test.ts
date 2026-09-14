import { describe, expect, it } from "vitest";
import { fitTransform, getRelations, relatedModels, rewriteReferences, sheetbaseFieldsOf, tableHeaderFields, validateGraph, withAutoLayout } from "./graph";
import type { SchemaGraph, SchemaRelation } from "./types";

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

  it("merges explicit relations and drops the ones pointing at missing models", () => {
    const linked: SchemaGraph = {
      models: graph.models,
      relations: [
        { id: "lineage:customer->order", fromModel: "customer", fromField: "", toModel: "order", toField: "", kind: "lineage" },
        { id: "lineage:ghost->order", fromModel: "ghost", fromField: "", toModel: "order", toField: "", kind: "lineage" },
      ],
    };
    expect(getRelations(linked)).toEqual([
      { id: "order.customer_id->customer.id", fromModel: "order", fromField: "customer_id", toModel: "customer", toField: "id" },
      { id: "lineage:customer->order", fromModel: "customer", fromField: "", toModel: "order", toField: "", kind: "lineage" },
    ]);
  });

  it("does not double-draw an explicit relation that restates a field reference", () => {
    const duplicated: SchemaGraph = {
      models: graph.models,
      relations: [
        { id: "order.customer_id->customer.id", fromModel: "order", fromField: "customer_id", toModel: "customer", toField: "id", kind: "join" },
      ],
    };
    expect(getRelations(duplicated)).toHaveLength(1);
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

  it("preserves explicit relations", () => {
    const links: SchemaRelation[] = [
      { id: "lineage:customer->order", fromModel: "customer", fromField: "", toModel: "order", toField: "", kind: "lineage" },
    ];
    expect(withAutoLayout({ models: graph.models, relations: links }).relations).toBe(links);
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

  it("rewrites explicit relations on rename and drops them on delete", () => {
    const linked: SchemaGraph = {
      models: [...graph.models, { name: "summary", fields: [] }],
      relations: [
        { id: "lineage:customer->summary", fromModel: "customer", fromField: "", toModel: "summary", toField: "", kind: "lineage" },
        { id: "join:order.customer_id->customer.id", fromModel: "order", fromField: "customer_id", toModel: "customer", toField: "id", kind: "join" },
        { id: "lineage:summary->order", fromModel: "summary", fromField: "", toModel: "order", toField: "", kind: "lineage" },
      ],
    };
    const renamed = rewriteReferences(linked, { kind: "rename-model", from: "customer", to: "client" });
    expect(renamed.relations?.map((relation) => relation.id)).toEqual([
      "lineage:client->summary",
      "order.customer_id->client.id",
      "lineage:summary->order",
    ]);
    const deleted = rewriteReferences(linked, { kind: "delete-model", name: "customer" });
    expect(deleted.relations).toEqual([
      { id: "lineage:summary->order", fromModel: "summary", fromField: "", toModel: "order", toField: "", kind: "lineage" },
    ]);
  });
});

describe("relatedModels", () => {
  it("returns the selection plus every linked model", () => {
    const relations = getRelations(graph);
    expect([...relatedModels(relations, "customer")].sort()).toEqual(["customer", "order"]);
    expect([...relatedModels(relations, "order")].sort()).toEqual(["customer", "order"]);
    expect([...relatedModels([], "order")]).toEqual(["order"]);
  });

  it("walks the full upstream and downstream chain", () => {
    const chain: SchemaGraph = {
      models: [
        { name: "a", fields: [] },
        { name: "b", fields: [{ key: "a_id", type: "relationship", references: { model: "a" } }] },
        { name: "c", fields: [{ key: "b_id", type: "relationship", references: { model: "b" } }] },
        { name: "unrelated", fields: [] },
      ],
    };
    const relations = getRelations(chain);
    expect([...relatedModels(relations, "b")].sort()).toEqual(["a", "b", "c"]);
    expect([...relatedModels(relations, "c")].sort()).toEqual(["a", "b", "c"]);
    expect([...relatedModels(relations, "a")].sort()).toEqual(["a", "b", "c"]);
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
