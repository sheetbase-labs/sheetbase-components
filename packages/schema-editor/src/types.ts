import type { FieldDataType, FieldReference } from "sheetbase-shared";

export type FieldType = FieldDataType;

export interface SchemaField {
  key: string;
  label?: string;
  type: FieldType;
  nullable?: boolean;
  primaryKey?: boolean;
  references?: FieldReference;
}

export interface SchemaModel {
  name: string;
  label?: string;
  fields: SchemaField[];
  /** Canvas position in world coords. Auto-assigned when absent. */
  position?: { x: number; y: number };
}

export interface SchemaGraph {
  models: SchemaModel[];
}

export interface SchemaRelation {
  id: string;
  fromModel: string;
  fromField: string;
  toModel: string;
  toField: string;
}

export const EMPTY_GRAPH: SchemaGraph = { models: [] };
