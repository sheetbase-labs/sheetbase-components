import { describe, expect, it } from "vitest";
import { graphToDdl, graphToProvision, quoteIdent, SchemaValidationError } from "./ddl";
import type { SchemaGraph } from "./types";

const graph: SchemaGraph = {
  models: [
    {
      name: "customer",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "name", type: "text", nullable: false },
        { key: "joined", type: "datetime" },
      ],
    },
    {
      name: "order",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "total", type: "number" },
        { key: "paid", type: "boolean" },
        { key: "placed_on", type: "date" },
        { key: "customer_id", type: "relationship", references: { model: "customer" } },
      ],
    },
  ],
};

describe("graphToDdl", () => {
  it("emits create-table DDL for every field type", () => {
    expect(graphToDdl(graph)).toBe(
      'create table "customer" (\n' +
      '  "id" text primary key,\n' +
      '  "name" text not null,\n' +
      '  "joined" timestamptz\n' +
      ');\n\n' +
      'create table "order" (\n' +
      '  "id" text primary key,\n' +
      '  "total" numeric,\n' +
      '  "paid" boolean,\n' +
      '  "placed_on" date,\n' +
      '  "customer_id" text references "customer"("id")\n' +
      ');',
    );
  });

  it("types an FK column after the referenced PK's type", () => {
    const g: SchemaGraph = {
      models: [
        { name: "seq", fields: [{ key: "n", type: "number", primaryKey: true }] },
        { name: "row", fields: [{ key: "seq_n", type: "relationship", references: { model: "seq" } }] },
      ],
    };
    expect(graphToDdl(g)).toContain('"seq_n" numeric references "seq"("n")');
  });

  it("falls back to text when the reference names a non-PK field", () => {
    const g: SchemaGraph = {
      models: [
        { name: "a", fields: [{ key: "code", type: "text" }] },
        { name: "b", fields: [{ key: "a_code", type: "relationship", references: { model: "a", field: "code" } }] },
      ],
    };
    expect(graphToDdl(g)).toContain('"a_code" text references "a"("code")');
  });

  it("refuses to emit when the graph is invalid", () => {
    const bad: SchemaGraph = { models: [{ name: "a", fields: [{ key: "x", type: "text" }, { key: "x", type: "text" }] }] };
    expect(() => graphToDdl(bad)).toThrow(SchemaValidationError);
  });

  it("quotes identifiers containing quotes", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    const g: SchemaGraph = { models: [{ name: 'my"model', fields: [{ key: "id", type: "text", primaryKey: true }] }] };
    expect(graphToDdl(g)).toContain('create table "my""model"');
  });
});

describe("graphToProvision", () => {
  it("emits the cleaned provisioning payload", () => {
    expect(graphToProvision(graph)).toEqual({
      models: [
        {
          name: "customer",
          fields: [
            { key: "id", type: "text", primaryKey: true },
            { key: "name", type: "text", nullable: false },
            { key: "joined", type: "datetime" },
          ],
        },
        {
          name: "order",
          fields: [
            { key: "id", type: "text", primaryKey: true },
            { key: "total", type: "number" },
            { key: "paid", type: "boolean" },
            { key: "placed_on", type: "date" },
            { key: "customer_id", type: "relationship", references: { model: "customer" } },
          ],
        },
      ],
    });
  });

  it("refuses invalid graphs", () => {
    const bad: SchemaGraph = { models: [{ name: "", fields: [] }] };
    expect(() => graphToProvision(bad)).toThrow(SchemaValidationError);
  });
});
