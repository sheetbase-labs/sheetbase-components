import { fieldFromSchema, toFieldDataType, type SheetbaseField } from "sheetbase-shared";
import type { SchemaField, SchemaGraph, SchemaModel, SchemaRelation, SchemaRelationKind } from "./types";

export const NODE_WIDTH = 232;
export const NODE_HEADER_HEIGHT = 48;
export const NODE_FIELD_HEIGHT = 22;

export type ReferenceChange =
  | { kind: "rename-model"; from: string; to: string }
  | { kind: "delete-model"; name: string }
  | { kind: "rename-field"; model: string; from: string; to: string }
  | { kind: "delete-field"; model: string; key: string };

/** Structural edge identity — shared by field references and explicit relations. */
export function relationId(fromModel: string, fromField: string, toModel: string, toField: string): string {
  return `${fromModel}.${fromField}->${toModel}.${toField}`;
}

/** Edge identity: structural for field-level edges, kind-prefixed for model-level ones (lineage). */
export function relationEdgeId(fromModel: string, fromField: string, toModel: string, toField: string, kind?: SchemaRelationKind): string {
  if (!fromField && !toField) return `${kind ?? "reference"}:${fromModel}->${toModel}`;
  return relationId(fromModel, fromField, toModel, toField);
}

/** Query-import nodes (`cte`/`subquery`/`query`/`view`) are design-time only, not provisionable tables. */
export function isDerivedModel(model: Pick<SchemaModel, "kind">): boolean {
  return model.kind !== undefined && model.kind !== "table";
}

/** Models that materialise as tables — the ones DDL emission and diffing cover. */
export function tableModels(graph: SchemaGraph): SchemaModel[] {
  return graph.models.filter((model) => !isDerivedModel(model));
}

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

/** Rewrite or drop an explicit relation. Returns null when the change deletes one of its ends. */
function rewriteRelation(relation: SchemaRelation, change: ReferenceChange): SchemaRelation | null {
  const touches = (model: string, field: string) => {
    if (change.kind === "rename-model") return model === change.from;
    if (change.kind === "delete-model") return model === change.name;
    if (change.kind === "rename-field") return model === change.model && field === change.from;
    return model === change.model && field === change.key;
  };
  const rewriteSide = (model: string, field: string): { model: string; field: string } => {
    if (change.kind === "rename-model" && model === change.from) return { model: change.to, field };
    if (change.kind === "rename-field" && model === change.model && field === change.from) return { model, field: change.to };
    return { model, field };
  };
  if (change.kind === "delete-model" || change.kind === "delete-field") {
    if (touches(relation.fromModel, relation.fromField) || touches(relation.toModel, relation.toField)) return null;
    return relation;
  }
  const from = rewriteSide(relation.fromModel, relation.fromField);
  const to = rewriteSide(relation.toModel, relation.toField);
  if (from.model === relation.fromModel && from.field === relation.fromField && to.model === relation.toModel && to.field === relation.toField) {
    return relation;
  }
  return {
    ...relation,
    fromModel: from.model,
    fromField: from.field,
    toModel: to.model,
    toField: to.field,
    id: relationEdgeId(from.model, from.field, to.model, to.field, relation.kind),
  };
}

/** Rewrite or drop FK pointers so rename/delete cannot leave dangling identity. */
export function rewriteReferences(graph: SchemaGraph, change: ReferenceChange): SchemaGraph {
  const models = graph.models.map((model) => ({
    ...model,
    fields: model.fields.map((field) => rewriteFieldRef(field, change)),
  }));
  const rewritten = graph.relations?.map((relation) => rewriteRelation(relation, change)).filter((relation): relation is SchemaRelation => relation !== null);
  return {
    models,
    ...(rewritten && rewritten.length > 0 ? { relations: rewritten } : {}),
  };
}

/** Sheetbase fields plus table column indices for DatasetHeaderConfig. */
export function tableHeaderFields(model: SchemaModel): Array<SheetbaseField & { column: number }> {
  return sheetbaseFieldsOf(model).map((field, column) => ({ ...field, column }));
}

/** Extract FK-style edges from relationship fields + explicit references, then merge query-import edges.
 * Dangling refs are omitted here (colour them in the inspector via validateGraph). */
export function getRelations(graph: SchemaGraph): SchemaRelation[] {
  const out: SchemaRelation[] = [];
  const seen = new Set<string>();
  for (const model of graph.models) {
    for (const field of model.fields) {
      if (!field.references) continue;
      const target = graph.models.find((m) => m.name === field.references?.model);
      if (!target) continue; // dangling — surfaced by validateGraph, not drawn
      const toField = field.references.field ?? primaryKeyOf(target) ?? target.fields[0]?.key ?? "";
      const id = relationId(model.name, field.key, target.name, toField);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        fromModel: model.name,
        fromField: field.key,
        toModel: target.name,
        toField,
      });
    }
  }
  for (const relation of graph.relations ?? []) {
    if (seen.has(relation.id)) continue;
    if (!graph.models.some((m) => m.name === relation.fromModel)) continue;
    if (!graph.models.some((m) => m.name === relation.toModel)) continue;
    seen.add(relation.id);
    out.push(relation);
  }
  return out;
}

export function primaryKeyOf(model: SchemaModel): string | undefined {
  return model.fields.find((f) => f.primaryKey)?.key;
}

/**
 * Selected model plus everything reachable through relations — the full
 * upstream and downstream chain, not just immediate neighbours. Drives focus
 * mode's visible set.
 */
export function relatedModels(relations: readonly SchemaRelation[], selected: string): Set<string> {
  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const set = neighbours.get(from) ?? new Set<string>();
    set.add(to);
    neighbours.set(from, set);
  };
  for (const relation of relations) {
    link(relation.fromModel, relation.toModel);
    link(relation.toModel, relation.fromModel);
  }
  const seen = new Set<string>([selected]);
  const queue: string[] = [selected];
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
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
      if (field.references) {
        const target = graph.models.find((m) => m.name === field.references?.model);
        if (!target) errors.push(`${model.name}.${field.key} references missing model "${field.references.model}".`);
        else if (field.references.field && !target.fields.some((f) => f.key === field.references?.field)) {
          errors.push(`${model.name}.${field.key} references missing field "${field.references.field}" on "${field.references.model}".`);
        }
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
  return { ...graph, models };
}

/** Bounding box of all node positions — used for "fit" zoom. */
export function graphBounds(graph: SchemaGraph): { x: number; y: number; w: number; h: number } | null {
  const positioned = graph.models.filter((m) => m.position);
  if (positioned.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of positioned) {
    const p = m.position;
    if (!p) continue;
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
