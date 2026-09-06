import { fieldFromSchema, toFieldDataType } from "sheetbase-shared";
import type { SchemaGraph, SchemaModel, SchemaRelation } from "./types";

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
    maxX = Math.max(maxX, p.x + 240); maxY = Math.max(maxY, p.y + 120);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
