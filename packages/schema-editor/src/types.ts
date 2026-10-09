import type { FieldDataType, FieldReference } from "@sheetbase-labs/sheetbase-shared";

export type FieldType = FieldDataType;

/**
 * How a model came to exist. `table` (or absent) is a provisionable entity;
 * `cte`, `subquery`, `query` and `view` are query-import nodes — the canvas
 * draws them, but they are not emitted as `create table` DDL.
 */
export type SchemaModelKind = "table" | "cte" | "subquery" | "query" | "view";

export interface SchemaField {
  key: string;
  label?: string;
  type: FieldType;
  nullable?: boolean;
  primaryKey?: boolean;
  references?: FieldReference;
  /** Source expression when the field came from query SQL, e.g. `cast(total as decimal(12, 2))`. */
  expression?: string;
  /** True when the field is computed (cast, function, arithmetic) rather than a plain column. */
  derived?: boolean;
}

export interface SchemaModel {
  name: string;
  label?: string;
  fields: SchemaField[];
  /** Canvas position in world coords. Auto-assigned when absent. */
  position?: { x: number; y: number };
  /** Absent means a hand-built or DDL-imported table. Query imports mark CTEs, subqueries, results and views. */
  kind?: SchemaModelKind;
  /** The SQL body a derived model came from (CTE/subquery/select). */
  sql?: string;
}

export interface SchemaGraph {
  models: SchemaModel[];
  /**
   * Edges that are not implied by a field's `references`: join predicates and
   * query lineage from SQL imports. `getRelations` merges these with the
   * field-level edges and drops any that point at missing models.
   */
  relations?: SchemaRelation[];
}

export type SchemaRelationKind = "reference" | "join" | "lineage";

export interface SchemaRelation {
  id: string;
  fromModel: string;
  fromField: string;
  toModel: string;
  toField: string;
  /** Absent means `reference` — the edge derived from a field's `references`. */
  kind?: SchemaRelationKind;
  /** Join predicate or lineage note, surfaced as the edge tooltip. */
  label?: string;
}

export const EMPTY_GRAPH: SchemaGraph = { models: [] };
