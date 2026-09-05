import { fieldFromSchema, toFieldDataType, type SheetbaseField } from "sheetbase-shared";
import type { SchemaField, SchemaGraph, SchemaModel, SchemaRelation } from "./types";

export const NODE_WIDTH = 232;
export const NODE_HEADER_HEIGHT = 48;
export const NODE_FIELD_HEIGHT = 22;

export type ReferenceChange =
  | { kind: "rename-model"; from: string; to: string }
  | { kind: "delete-model"; name: string }
  | { kind: "rename-field"; model: string; from: string; to: string }
  | { kind: "delete-field"; model: string; key: string };

export function nodeHeight(model: SchemaModel): number {
  return NODE_HEADER_HEIGHT + model.fields.length * NODE_FIELD_HEIGHT;
}

function rewriteFieldRef(field: SchemaField, change: ReferenceChange): SchemaField {
  const ref = field.references;
  if (!ref) return field;
  if (change.kind === "rename-model" && ref.model === change.from) {
    return { ...field, references: { ...ref, model: change.to } };
  }
  if (change.kind === "delete-model" && ref.model === change.name) {
    return { ...field, references: undefined, type: field.type === "relationship" ? "text" : field.type };
  }
  if (change.kind === "rename-field" && ref.model === change.model && (ref.field ?? undefined) === change.from) {
    return { ...field, references: { ...ref, field: change.to } };
  }
  if (change.kind === "delete-field" && ref.model === change.model && (ref.field ?? undefined) === change.key) {
    return { ...field, references: { model: ref.model } };
  }
  return field;
}

/** Rewrite or drop FK pointers so rename/delete cannot leave dangling identity. */
export function rewriteReferences(graph: SchemaGraph, change: ReferenceChange): SchemaGraph {
  return {
    models: graph.models.map((model) => ({
      ...model,
      fields: model.fields.map((field) => rewriteFieldRef(field, change)),
    })),
  };
}

/** Sheetbase fields plus table column indices for DatasetHeaderConfig. */
export function tableHeaderFields(model: SchemaModel): Array<SheetbaseField & { column: number }> {
  return sheetbaseFieldsOf(model).map((field, column) => ({ ...field, column }));
}

/** Extract FK-style edges from relationship fields + explicit references.
 * Dangling refs are omitted here (colour them in the inspector via validateGraph). */
export function getRelations(graph: SchemaGraph): SchemaRelation[] {
  const out: SchemaRelation[] = [];
  for (const model of graph.models) {
    for (const field of model.fields) {
      if (!field.references) continue;
      const target = graph.models.find((m) => m.name === field.references!.model);
      if (!target) continue; // dangling — surfaced by validateGraph, not drawn
      out.push({
        id: `${model.name}.${field.key}->${target.name}.${field.references.field ?? primaryKeyOf(target) ?? target.fields[0]?.key ?? ""}`,
        fromModel: model.name,
        fromField: field.key,
        toModel: target.name,
        toField: field.references.field ?? primaryKeyOf(target) ?? target.fields[0]?.key ?? "",
      });
    }
  }
  return out;
}

export function primaryKeyOf(model: SchemaModel): string | undefined {
  return model.fields.find((f) => f.primaryKey)?.key;
}

/** Canonical Sheetbase fields for a model (normalises legacy type names). */
export function sheetbaseFieldsOf(model: SchemaModel) {
  return model.fields.map((field) => fieldFromSchema({
    ...field,
    type: toFieldDataType(field.type),
  }));
}

/** Human-readable problems: duplicates, empty names, dangling references. */
export function validateGraph(graph: SchemaGraph): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const model of graph.models) {
    if (!model.name.trim()) errors.push("Model with empty name.");
    else if (names.has(model.name)) errors.push(`Duplicate model "${model.name}".`);
    else names.add(model.name);
    const keys = new Set<string>();
    for (const field of model.fields) {
      if (!field.key.trim()) errors.push(`${model.name || "<unnamed>"} has a field with an empty key.`);
      else if (keys.has(field.key)) errors.push(`${model.name}.${field.key} is defined twice.`);
      else keys.add(field.key);
      if (field.references && !graph.models.some((m) => m.name === field.references!.model)) {
        errors.push(`${model.name}.${field.key} references missing model "${field.references.model}".`);
      }
    }
  }
  return errors;
}

/** Grid auto-layout for models missing a position. Pure — never mutates input. */
export function withAutoLayout(graph: SchemaGraph, columnWidth = 300, rowHeight = 260, columns = 3): SchemaGraph {
  let placed = 0;
  const models = graph.models.map((model) => {
    if (model.position) return model;
    const position = {
      x: 24 + (placed % columns) * columnWidth,
      y: 24 + Math.floor(placed / columns) * rowHeight,
    };
    placed += 1;
    return { ...model, position };
  });
  return { models };
}

/** Bounding box of all node positions — used for "fit" zoom. */
export function graphBounds(graph: SchemaGraph): { x: number; y: number; w: number; h: number } | null {
  const positioned = graph.models.filter((m) => m.position);
  if (positioned.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of positioned) {
    const p = m.position!;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_WIDTH); maxY = Math.max(maxY, p.y + nodeHeight(m));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Pan + zoom that fits `bounds` inside a viewport, clamped to the editor zoom range. */
export function fitTransform(
  bounds: { x: number; y: number; w: number; h: number },
  viewportWidth: number,
  viewportHeight: number,
  pad = 48,
): { zoom: number; x: number; y: number } {
  const availW = Math.max(1, viewportWidth - pad);
  const availH = Math.max(1, viewportHeight - pad);
  const zoom = Math.min(2, Math.max(0.4, Math.min(availW / Math.max(bounds.w, 1), availH / Math.max(bounds.h, 1))));
  return {
    zoom,
    x: pad / 2 - bounds.x * zoom,
    y: pad / 2 - bounds.y * zoom,
  };
}
