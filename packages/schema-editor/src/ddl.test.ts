import { describe, expect, it } from "vitest";
import { ddlToGraph, diffGraphs, graphDiffToDdl, graphToDdl, graphToProvision, quoteIdent, SchemaParseError, SchemaValidationError } from "./ddl";
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

describe("ddlToGraph", () => {
  it("round-trips emitted DDL back to the same models and fields", () => {
    const parsed = ddlToGraph(graphToDdl(graph));
    expect(parsed.models.map((m) => ({ name: m.name, fields: m.fields }))).toEqual(
      graph.models.map((m) => ({ name: m.name, fields: m.fields })),
    );
  });

  it("reads common Postgres spellings", () => {
    const parsed = ddlToGraph(`
      create table if not exists public.samples (
        id serial primary key,
        label varchar(80) not null,
        ratio double precision,
        taken_at timestamp with time zone,
        batch_id integer references "batches"("id")
      );
      create table "batches" ( "id" int, primary key ("id") );
    `);
    const [samples, batches] = parsed.models;
    expect(samples.name).toBe("samples");
    expect(samples.fields).toEqual([
      { key: "id", type: "number", primaryKey: true },
      { key: "label", type: "text", nullable: false },
      { key: "ratio", type: "number" },
      { key: "taken_at", type: "datetime" },
      { key: "batch_id", type: "relationship", references: { model: "batches" } }, // "id" is the target pk — kept implicit
    ]);
    expect(batches.name).toBe("batches");
    expect(batches.fields[0]).toEqual({ key: "id", type: "number", primaryKey: true, nullable: false });
  });

  it("maps table-level foreign keys onto the column", () => {
    const parsed = ddlToGraph(`
      create table "orders" ( "id" int primary key, "customer_id" int not null,
        foreign key ("customer_id") references "customers"("id") );
      create table "customers" ( "id" int primary key );
    `);
    expect(parsed.models[0].fields[1]).toEqual({
      key: "customer_id", type: "relationship", nullable: false,
      references: { model: "customers" },
    });
  });

  it("keeps a non-pk reference target explicit", () => {
    const parsed = ddlToGraph(`
      create table "c" ( "code" text, unique ("code") );
      create table "o" ( "c_code" text references "c"("code") );
    `);
    expect(parsed.models[1].fields[0].references).toEqual({ model: "c", field: "code" });
  });

  it("throws SchemaParseError when nothing parses", () => {
    expect(() => ddlToGraph("select 1;")).toThrow(SchemaParseError);
    expect(() => ddlToGraph("")).toThrow(SchemaParseError);
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

describe("diffGraphs / graphDiffToDdl", () => {
  it("diffs identical graphs to nothing and emits no DDL", () => {
    const diff = diffGraphs(graph, graph);
    expect(diff).toEqual({ create: [], drop: [], alter: [], destructive: [], warnings: [] });
    expect(graphDiffToDdl(graph, graph)).toBe("");
  });

  it("emits add column for a new field", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "order"
          ? { ...model, fields: [...model.fields, { key: "discount", type: "number" as const }] }
          : model),
    };
    expect(graphDiffToDdl(graph, next)).toBe('alter table "order"\n  add column "discount" numeric;');
    expect(diffGraphs(graph, next).destructive).toEqual([]);
  });

  it("reports a dropped field as destructive and gates the clause behind drops:true", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "order"
          ? { ...model, fields: model.fields.filter((field) => field.key !== "paid") }
          : model),
    };
    const diff = diffGraphs(graph, next);
    expect(diff.destructive).toEqual(['drops column "paid" on "order"']);
    // Default emission is additive-safe: no drop column clause.
    expect(graphDiffToDdl(graph, next)).toBe("");
    expect(graphDiffToDdl(graph, next, { drops: true })).toBe('alter table "order"\n  drop column "paid";');
  });

  it("treats a field rename as drop+add and flags it destructive", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "order"
          ? { ...model, fields: model.fields.map((field) => (field.key === "paid" ? { ...field, key: "is_paid" } : field)) }
          : model),
    };
    const diff = diffGraphs(graph, next);
    expect(diff.destructive).toEqual(['drops column "paid" on "order"']);
    expect(graphDiffToDdl(graph, next, { drops: true })).toBe(
      'alter table "order"\n  add column "is_paid" boolean,\n  drop column "paid";',
    );
  });

  it("emits set/drop not null on nullable flips", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "order"
          ? { ...model, fields: model.fields.map((field) => (field.key === "total" ? { ...field, nullable: false } : field)) }
          : model),
    };
    expect(graphDiffToDdl(graph, next)).toBe('alter table "order"\n  alter column "total" set not null;');
    expect(graphDiffToDdl(next, graph)).toBe('alter table "order"\n  alter column "total" drop not null;');
  });

  it("emits alter column type on a field-type change", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "order"
          ? { ...model, fields: model.fields.map((field) => (field.key === "total" ? { ...field, type: "text" as const } : field)) }
          : model),
    };
    const diff = diffGraphs(graph, next);
    expect(diff.destructive).toEqual(['alters type of "total" on "order" (numeric → text)']);
    expect(graphDiffToDdl(graph, next)).toBe('alter table "order"\n  alter column "total" type text;');
  });

  it("emits inline references for a new relationship column", () => {
    const next: SchemaGraph = {
      models: graph.models.map((model) =>
        model.name === "customer"
          ? { ...model, fields: [...model.fields, { key: "referrer_id", type: "relationship" as const, references: { model: "customer" } }] }
          : model),
    };
    expect(graphDiffToDdl(graph, next)).toBe('alter table "customer"\n  add column "referrer_id" text references "customer"("id");');
  });

  it("emits add/drop constraint when a reference target changes", () => {
    const next: SchemaGraph = {
      models: [
        ...graph.models,
        { name: "account", fields: [{ key: "id", type: "number" as const, primaryKey: true }] },
      ].map((model) =>
        model.name === "order"
          ? { ...model, fields: model.fields.map((field) => (field.key === "customer_id" ? { ...field, references: { model: "account" } } : field)) }
          : model),
    };
    const ddl = graphDiffToDdl(graph, next);
    expect(ddl).toContain('create table "account"');
    expect(ddl).toContain('alter table "order"\n  alter column "customer_id" type numeric,\n  drop constraint "order_customer_id_fkey",\n  add constraint "order_customer_id_fkey" foreign key ("customer_id") references "account"("id");');
  });

  it("creates new models, drops removed ones only under drops:true", () => {
    const next: SchemaGraph = {
      models: [
        graph.models[0],
        { name: "line_item", fields: [{ key: "id", type: "text" as const, primaryKey: true }] },
      ],
    };
    const diff = diffGraphs(graph, next);
    expect(diff.create.map((model) => model.name)).toEqual(["line_item"]);
    expect(diff.drop).toEqual(["order"]);
    expect(diff.destructive).toEqual(['drops table "order" (5 fields)']);
    const additive = graphDiffToDdl(graph, next);
    expect(additive).toContain('create table "line_item"');
    expect(additive).not.toContain("drop table");
    const full = graphDiffToDdl(graph, next, { drops: true });
    expect(full.endsWith('drop table "order";')).toBe(true);
    // Creates land before drops.
    expect(full.indexOf('create table "line_item"')).toBeLessThan(full.indexOf('drop table "order"'));
  });

  it("diffs a hand-edited graph against the re-imported live DDL", () => {
    const previous = ddlToGraph(graphToDdl(graph));
    const next: SchemaGraph = {
      models: previous.models.map((model) =>
        model.name === "customer"
          ? { ...model, fields: [...model.fields, { key: "email", type: "text" as const }] }
          : model),
    };
    expect(graphDiffToDdl(previous, next)).toBe('alter table "customer"\n  add column "email" text;');
  });

  it("throws SchemaValidationError on an invalid next graph", () => {
    const bad: SchemaGraph = { models: [{ name: "a", fields: [{ key: "x", type: "text" }, { key: "x", type: "text" }] }] };
    expect(() => diffGraphs(graph, bad)).toThrow(SchemaValidationError);
    expect(() => graphDiffToDdl(graph, bad)).toThrow(SchemaValidationError);
  });
});

describe("query-import nodes", () => {
  const withQueryNodes: SchemaGraph = {
    models: [
      { name: "orders", fields: [{ key: "id", type: "text", primaryKey: true }] },
      { name: "recent", kind: "cte", fields: [{ key: "id", type: "text" }], sql: "select id from orders" },
      { name: "query_1", kind: "query", label: "Query 1", fields: [{ key: "id", type: "text" }], sql: "select id from recent" },
    ],
  };

  it("emits DDL and payloads for tables only", () => {
    expect(graphToDdl(withQueryNodes)).toBe('create table "orders" (\n  "id" text primary key\n);');
    expect(graphToProvision(withQueryNodes).models.map((model) => model.name)).toEqual(["orders"]);
  });

  it("ignores query nodes when diffing", () => {
    const diff = diffGraphs(withQueryNodes, {
      models: [...withQueryNodes.models, { name: "extra", kind: "view", fields: [{ key: "id", type: "text" }] }],
    });
    expect(diff.create).toEqual([]);
    expect(diff.drop).toEqual([]);
    expect(diff.alter).toEqual([]);
    expect(diff.destructive).toEqual([]);
  });
});
