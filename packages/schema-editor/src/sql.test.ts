import { describe, expect, it } from "vitest";
import { SchemaParseError } from "./ddl";
import { analyzeSql, sqlToGraph } from "./sql";
import type { SchemaField, SchemaGraph, SchemaModel } from "./types";

function model(graph: SchemaGraph, name: string): SchemaModel {
  const found = graph.models.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing model ${name}`);
  return found;
}

function field(model: SchemaModel, key: string): SchemaField {
  const found = model.fields.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing field ${key} on ${model.name}`);
  return found;
}

describe("analyzeSql — single query", () => {
  const sql = `
    select cast(o.total as decimal(12,2)) as total, o.id
    from sales.orders o
  `;

  it("draws the source table with the referenced columns", () => {
    const { graph } = analyzeSql(sql);
    const orders = model(graph, "sales.orders");
    expect(orders.kind).toBeUndefined();
    expect(orders.fields).toEqual([
      { key: "total", type: "text" },
      { key: "id", type: "text" },
    ]);
  });

  it("builds a result node with inferred output types and expressions", () => {
    const { graph } = analyzeSql(sql);
    const result = model(graph, "query_1");
    expect(result.kind).toBe("query");
    expect(result.label).toBe("Query 1");
    expect(result.fields).toEqual([
      { key: "total", type: "number", derived: true, expression: "cast(o.total as decimal(12, 2))" },
      { key: "id", type: "text", expression: "o.id" },
    ]);
    expect(result.sql).toContain("select cast(o.total as decimal(12,2)) as total, o.id");
  });

  it("links the source to the result with a lineage edge", () => {
    const { graph } = analyzeSql(sql);
    expect(graph.relations).toEqual([
      { id: "lineage:sales.orders->query_1", fromModel: "sales.orders", fromField: "", toModel: "query_1", toField: "", kind: "lineage" },
    ]);
  });

  it("folds unquoted identifiers and keeps quoted ones", () => {
    const { graph } = analyzeSql('select O.ID, o."Mixed" from Orders O');
    expect(model(graph, "orders").fields.map((f) => f.key)).toEqual(["id", "Mixed"]);
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id", "Mixed"]);
  });

  it("names computed columns when the query does not alias them", () => {
    const { graph } = analyzeSql("select count(*), total * 2, o.id from orders o");
    const result = model(graph, "query_1");
    expect(result.fields.map((f) => f.key)).toEqual(["count", "total_2", "id"]);
    expect(result.fields[0]).toMatchObject({ type: "number", derived: true, expression: "count(*)" });
    expect(result.fields[1]).toMatchObject({ type: "number", derived: true });
  });

  it("keeps pass-through columns undecorated", () => {
    const { graph } = analyzeSql("select o.id from orders o");
    expect(field(model(graph, "query_1"), "id")).toEqual({ key: "id", type: "text", expression: "o.id" });
  });
});

describe("analyzeSql — joins", () => {
  const sql = `
    select c.id, c.name, o.total
    from sales.customers c
    join sales.orders o on o.customer_id = c.id
    left join sales.regions r on r.id = c.region_id and r.active = true
  `;

  it("emits a join edge per equality predicate", () => {
    const { graph } = analyzeSql(sql);
    const joins = (graph.relations ?? []).filter((relation) => relation.kind === "join");
    expect(joins).toEqual([
      {
        id: "sales.orders.customer_id->sales.customers.id",
        fromModel: "sales.orders", fromField: "customer_id",
        toModel: "sales.customers", toField: "id",
        kind: "join", label: "o.customer_id = c.id",
      },
      {
        id: "sales.regions.id->sales.customers.region_id",
        fromModel: "sales.regions", fromField: "id",
        toModel: "sales.customers", toField: "region_id",
        kind: "join", label: "r.id = c.region_id",
      },
    ]);
  });

  it("registers join keys and where columns on the base tables", () => {
    const { graph } = analyzeSql(sql);
    expect(model(graph, "sales.customers").fields.map((f) => f.key)).toEqual(["id", "name", "region_id"]);
    expect(model(graph, "sales.orders").fields.map((f) => f.key)).toEqual(["total", "customer_id"]);
    expect(model(graph, "sales.regions").fields.map((f) => f.key)).toEqual(["id", "active"]);
  });

  it("pairs columns joined through wrapping expressions", () => {
    const { graph } = analyzeSql("select 1 from a join b on lower(a.email) = lower(b.email)");
    expect((graph.relations ?? []).filter((r) => r.kind === "join")).toEqual([
      {
        id: "a.email->b.email",
        fromModel: "a", fromField: "email", toModel: "b", toField: "email",
        kind: "join", label: "lower(a.email) = lower(b.email)",
      },
    ]);
  });

  it("pairs USING columns", () => {
    const { graph } = analyzeSql("select 1 from a join b using (id, tenant_id)");
    const joins = (graph.relations ?? []).filter((r) => r.kind === "join");
    expect(joins.map((r) => [r.fromField, r.toField])).toEqual([["id", "id"], ["tenant_id", "tenant_id"]]);
  });

  it("keeps a self-join as a self-edge", () => {
    const { graph } = analyzeSql("select 1 from nodes a join nodes b on a.parent_id = b.id");
    const joins = (graph.relations ?? []).filter((r) => r.kind === "join");
    expect(joins).toEqual([
      {
        id: "nodes.parent_id->nodes.id",
        fromModel: "nodes", fromField: "parent_id", toModel: "nodes", toField: "id",
        kind: "join", label: "a.parent_id = b.id",
      },
    ]);
  });
});

describe("analyzeSql — CTEs and subqueries", () => {
  const sql = `
    with recent_orders as (
      select o.id as order_id,
             o.customer_id,
             cast(o.total as decimal(12,2)) as total
      from hive.sales.orders o
      where o.placed_at >= date '2024-01-01'
    )
    select c.id as customer_id, c.name, count(*) as order_count, sum(r.total) as lifetime_value
    from recent_orders r
    join hive.crm.customers c on c.id = r.customer_id
    group by c.id, c.name
  `;

  it("creates a node per CTE, table and result", () => {
    const { graph } = analyzeSql(sql);
    expect(graph.models.map((m) => m.name)).toEqual([
      "hive.sales.orders",
      "recent_orders",
      "hive.crm.customers",
      "query_1",
    ]);
    expect(model(graph, "recent_orders").kind).toBe("cte");
  });

  it("resolves columns through the CTE alias", () => {
    const { graph } = analyzeSql(sql);
    expect(model(graph, "hive.crm.customers").fields.map((f) => f.key)).toEqual(["id", "name"]);
    const result = model(graph, "query_1");
    expect(result.fields.map((f) => f.key)).toEqual(["customer_id", "name", "order_count", "lifetime_value"]);
    expect(field(result, "order_count")).toMatchObject({ type: "number", derived: true });
    expect(field(result, "lifetime_value")).toMatchObject({ type: "number", derived: true });
  });

  it("links the CTE to its sources and the result to the CTE", () => {
    const { graph } = analyzeSql(sql);
    const lineage = (graph.relations ?? []).filter((r) => r.kind === "lineage").map((r) => [r.fromModel, r.toModel]);
    expect(lineage).toEqual([
      ["hive.sales.orders", "recent_orders"],
      ["recent_orders", "query_1"],
      ["hive.crm.customers", "query_1"],
    ]);
    const joins = (graph.relations ?? []).filter((r) => r.kind === "join");
    expect(joins.map((r) => [r.fromModel, r.fromField, r.toModel, r.toField])).toEqual([
      ["hive.crm.customers", "id", "recent_orders", "customer_id"],
    ]);
  });

  it("lays the graph out in lineage order", () => {
    const { graph } = analyzeSql(sql);
    const x = (name: string) => model(graph, name).position?.x ?? -1;
    expect(x("hive.sales.orders")).toBeLessThan(x("recent_orders"));
    expect(x("recent_orders")).toBeLessThan(x("query_1"));
    expect(x("hive.crm.customers")).toBeLessThan(x("query_1"));
  });

  it("creates a node for a FROM subquery", () => {
    const { graph } = analyzeSql("select s.id from (select id from raw_events) s");
    expect(graph.models.map((m) => m.name)).toEqual(["raw_events", "s", "query_1"]);
    expect(model(graph, "s").kind).toBe("subquery");
    expect(model(graph, "s").fields.map((f) => f.key)).toEqual(["id"]);
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id"]);
  });

  it("applies CTE column aliases positionally", () => {
    const { graph } = analyzeSql("with t (a, b) as (select x, y from src) select a from t");
    expect(model(graph, "t").fields.map((f) => f.key)).toEqual(["a", "b"]);
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["a"]);
  });

  it("merges the union branches onto one result node", () => {
    const { graph } = analyzeSql("select id from a union all select id from b");
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id"]);
    const lineage = (graph.relations ?? []).filter((r) => r.kind === "lineage").map((r) => [r.fromModel, r.toModel]);
    expect(lineage).toEqual([["a", "query_1"], ["b", "query_1"]]);
  });
});

describe("analyzeSql — statements, views and DDL", () => {
  it("turns create view into a view node", () => {
    const { graph } = analyzeSql("create or replace view analytics.customer_totals as select c.id, sum(o.total) as total from customers c join orders o on o.customer_id = c.id group by c.id");
    expect(model(graph, "analytics.customer_totals").kind).toBe("view");
    expect(model(graph, "analytics.customer_totals").fields.map((f) => f.key)).toEqual(["id", "total"]);
  });

  it("turns create table as select into a query node named after the table", () => {
    const { graph } = analyzeSql("create table reporting.daily as select id, cast(ts as date) as day from events");
    expect(model(graph, "reporting.daily").kind).toBe("query");
    expect(model(graph, "reporting.daily").fields.map((f) => f.key)).toEqual(["id", "day"]);
  });

  it("merges create-table DDL with query analysis", () => {
    const { graph, warnings } = analyzeSql(`
      create table customers (id int primary key, name varchar(80) not null);
      create table orders (id int primary key, customer_id int references customers(id), total numeric);
      select c.name, o.total from orders o join customers c on o.customer_id = c.id;
    `);
    expect(warnings).toEqual([]);
    expect(model(graph, "customers").fields).toEqual([
      { key: "id", type: "number", primaryKey: true },
      { key: "name", type: "text", nullable: false },
    ]);
    expect(model(graph, "orders").fields.map((f) => f.key)).toEqual(["id", "customer_id", "total"]);
    const joins = (graph.relations ?? []).filter((r) => r.kind === "join");
    expect(joins.map((r) => [r.fromModel, r.fromField, r.toModel, r.toField])).toEqual([["orders", "customer_id", "customers", "id"]]);
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["name", "total"]);
  });

  it("numbers multiple query statements", () => {
    const { graph } = analyzeSql("select 1 from a; select 2 from b");
    expect(graph.models.map((m) => m.name)).toEqual(["a", "query_1", "b", "query_2"]);
  });

  it("throws SchemaParseError when nothing is recognised", () => {
    expect(() => analyzeSql("insert into a select * from b")).toThrow(SchemaParseError);
    expect(() => analyzeSql("")).toThrow(SchemaParseError);
    expect(() => sqlToGraph("drop table x")).toThrow(SchemaParseError);
  });
});

describe("analyzeSql — warnings and edge cases", () => {
  it("warns about unresolved aliases and columns", () => {
    const { graph, warnings } = analyzeSql("select z.id from a");
    expect(warnings).toContain('unknown table alias "z"');
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id"]);
  });

  it("warns when a derived column is missing", () => {
    const { warnings } = analyzeSql("with t as (select id from a) select t.nope from t");
    expect(warnings).toContain('column "nope" not found on "t"');
  });

  it("keeps a star placeholder and warns", () => {
    const { graph, warnings } = analyzeSql("select * from events");
    expect(warnings).toContain("select * from events: columns unknown");
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["*"]);
  });

  it("expands alias.* from a derived source", () => {
    const { graph } = analyzeSql("with t as (select id, name from a) select t.* from t");
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id", "name"]);
  });

  it("ignores comments and string contents", () => {
    const { graph } = analyzeSql(`
      -- from ghost_table
      select '-- not a comment' as note, id /* join phantom on x = y */ from real_table
    `);
    expect(graph.models.map((m) => m.name)).toEqual(["real_table", "query_1"]);
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["note", "id"]);
  });

  it("infers literal, cast and function types", () => {
    const { graph } = analyzeSql(`
      select
        1 + 2 as sum_literal,
        x::bigint as casted,
        date '2024-01-01' as started,
        current_timestamp as seen_at,
        true as flag,
        lower(name) as lowered
      from t
    `);
    const result = model(graph, "query_1");
    expect(result.fields.map((f) => f.type)).toEqual(["number", "number", "date", "datetime", "boolean", "text"]);
  });

  it("deduplicates repeated output names", () => {
    const { graph } = analyzeSql("select a.id, b.id from a join b on a.id = b.id");
    expect(model(graph, "query_1").fields.map((f) => f.key)).toEqual(["id", "id_2"]);
  });

  it("handles nested subqueries inside where clauses without leaking refs", () => {
    const { graph, warnings } = analyzeSql("select id from a where id in (select a_id from b where flag)");
    expect(warnings).toEqual([]);
    expect(graph.models.map((m) => m.name)).toEqual(["a", "query_1"]);
  });

  it("resolves group/order aliases to the select list instead of warning", () => {
    const { graph, warnings } = analyzeSql("select sum(o.total) as total, o.status from orders o group by o.status order by total desc");
    expect(warnings).toEqual([]);
    expect(model(graph, "orders").fields.map((f) => f.key)).toEqual(["total", "status"]);
  });
});

describe("analyzeSql — dbt projects", () => {
  const project = `
-- stg_events.sql
-- One row per source event.
select source_row_id as event_id, status as event_status
from {{ source('raw_events', 'events') }}

-- int_event_counts.sql
select event_id, count(*) as event_count
from {{ ref('stg_events') }}
group by event_id

-- mart_event_daily.sql
select c.event_id, c.event_count
from {{ ref('int_event_counts') }} as c
`;

  it("expands source()/ref() and names each file's node", () => {
    const { graph, warnings } = analyzeSql(project);
    expect(warnings).toEqual([]);
    expect(graph.models.map((m) => m.name)).toEqual([
      "raw_events.events",
      "stg_events",
      "int_event_counts",
      "mart_event_daily",
    ]);
    expect(model(graph, "raw_events.events").kind).toBeUndefined();
    expect(model(graph, "stg_events").kind).toBe("query");
    expect(model(graph, "stg_events").fields.map((f) => f.key)).toEqual(["event_id", "event_status"]);
  });

  it("parses concatenated files that omit semicolons", () => {
    const { graph } = analyzeSql(project);
    expect(model(graph, "mart_event_daily").fields.map((f) => f.key)).toEqual(["event_id", "event_count"]);
  });

  it("links refs to the model node instead of a duplicate table", () => {
    const { graph } = analyzeSql(project);
    const lineage = (graph.relations ?? []).filter((r) => r.kind === "lineage").map((r) => [r.fromModel, r.toModel]);
    expect(lineage).toEqual([
      ["raw_events.events", "stg_events"],
      ["stg_events", "int_event_counts"],
      ["int_event_counts", "mart_event_daily"],
    ]);
  });

  it("fills a model node whose file appears after the ref that uses it", () => {
    const reversed = `
-- mart_late.sql
select count(*) as rows_seen from {{ ref('int_early') }}

-- int_early.sql
select id from {{ source('raw', 't') }}
`;
    const { graph, warnings } = analyzeSql(reversed);
    expect(warnings).toEqual([]);
    expect(model(graph, "int_early").fields.map((f) => f.key)).toEqual(["id"]);
    expect((graph.relations ?? []).some((r) => r.fromModel === "int_early" && r.toModel === "mart_late")).toBe(true);
  });

  it("keeps external refs quiet and opaque", () => {
    const { graph, warnings } = analyzeSql("select m.id, m.name from {{ ref('external_model') }} m");
    expect(warnings).toEqual([]);
    expect(model(graph, "external_model").fields).toEqual([]);
  });

  it("resolves columns when files arrive out of dependency order", () => {
    const alphabetical = `
-- mart_top.sql
select c.id, c.total from {{ ref('int_mid') }} c

-- int_mid.sql
select o.id, o.total from {{ ref('stg_bottom') }} o

-- stg_bottom.sql
select id, total from {{ source('raw', 't') }}
`;
    const { graph, warnings } = analyzeSql(alphabetical);
    expect(warnings).toEqual([]);
    expect(model(graph, "stg_bottom").fields.map((f) => f.key)).toEqual(["id", "total"]);
    expect(model(graph, "mart_top").fields.map((f) => f.key)).toEqual(["id", "total"]);
  });

  it("ignores other Jinja tags", () => {
    const { graph } = analyzeSql("{{ config(materialized='table') }}\nselect id from {{ source('raw', 't') }}");
    expect(graph.models.map((m) => m.name)).toEqual(["raw.t", "query_1"]);
  });
});

describe("analyzeSql — Trino constructs", () => {
  it("models unnest with column aliases as a derived source", () => {
    const { graph, warnings } = analyzeSql(`
      with measurements as (
        select assay_data_id, metric_name, try_cast(json_format(metric_json) as double) as metric_value
        from raw.assay_data
        cross join unnest(map_entries(cast(json_parse(data_json) as map(varchar, json)))) as metrics(metric_name, metric_json)
      )
      select * from measurements where metric_value is not null
    `);
    expect(warnings).toEqual([]);
    expect(model(graph, "metrics").kind).toBe("subquery");
    expect(model(graph, "metrics").fields.map((f) => f.key)).toEqual(["metric_name", "metric_json"]);
    expect(model(graph, "measurements").fields.map((f) => f.key)).toEqual(["assay_data_id", "metric_name", "metric_value"]);
    expect(model(graph, "raw.assay_data").fields.map((f) => f.key)).toEqual(["assay_data_id", "data_json"]);
  });

  it("treats cast type names as types and same-named columns as columns", () => {
    const { graph } = analyzeSql("select cast(timestamp as date) as diagnostic_date, scope_type from issues");
    expect(model(graph, "issues").fields.map((f) => f.key)).toEqual(["timestamp", "scope_type"]);
    expect(field(model(graph, "query_1"), "diagnostic_date")).toMatchObject({ type: "date", derived: true });
  });

  it("understands grouping sets, row_number windows and date_diff", () => {
    const { graph, warnings } = analyzeSql(`
      select
        case when grouping(run_date) = 1 then 'all' else 'daily' end as aggregation_level,
        run_date,
        row_number() over (partition by plate_id order by timestamp desc) as row_number,
        date_diff('second', started_at, ended_at) as duration_seconds
      from steps
      group by grouping sets ((run_date), (run_date, scope_type))
    `);
    expect(warnings).toEqual([]);
    const result = model(graph, "query_1");
    expect(result.fields.map((f) => f.key)).toEqual(["aggregation_level", "run_date", "row_number", "duration_seconds"]);
    expect(field(result, "row_number").type).toBe("number");
    expect(field(result, "duration_seconds").type).toBe("number");
    expect(model(graph, "steps").fields.map((f) => f.key)).toEqual(["run_date", "plate_id", "timestamp", "started_at", "ended_at", "scope_type"]);
  });

  it("keeps model-level lineage for multi-CTE models", () => {
    const { graph, warnings } = analyzeSql(`
      with a as (select id from t1), b as (select id from t2)
      select a.id from a join b on a.id = b.id
    `);
    expect(warnings).toEqual([]);
    const joins = (graph.relations ?? []).filter((r) => r.kind === "join");
    expect(joins.map((r) => [r.fromModel, r.toModel])).toEqual([["a", "b"]]);
  });
});
