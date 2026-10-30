import { useEffect, useReducer } from "react";
import type { FieldOption, FilterNode, SheetbaseField } from "@sheetbase-labs/sheetbase-shared";

type FieldInput = string | SheetbaseField;
type Loader = NonNullable<SheetbaseField["loadOptions"]>;

/**
 * Labels for values chosen from an async `loadOptions` field, so a chip reads
 * "AAV8 TFF" and not a UUID. The cache is keyed by the loader itself: the
 * builder remembers a label the moment a choice is made, and the chips pick it
 * up without a second request.
 */
const labels = new WeakMap<Loader, Map<string, string>>();
const attempted = new WeakMap<Loader, Set<string>>();

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function labelsFor(loader: Loader): Map<string, string> {
  let map = labels.get(loader);
  if (!map) {
    map = new Map();
    labels.set(loader, map);
  }
  return map;
}

export function rememberOptions(field: SheetbaseField, options: readonly FieldOption[]): void {
  if (!field.loadOptions) return;
  const map = labelsFor(field.loadOptions);
  for (const option of options) map.set(option.value, option.label);
  notify();
}

/** The label remembered for `value`, if one has been loaded or chosen. */
export function cachedOptionLabel(field: SheetbaseField | undefined, value: unknown): string | undefined {
  if (!field?.loadOptions) return undefined;
  return labels.get(field.loadOptions)?.get(String(value));
}

function valuesOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
}

function collect(node: FilterNode | null | undefined, out: Array<{ field: string; value: unknown }> = []) {
  if (!node) return out;
  if (node.type === "condition") {
    for (const value of valuesOf(node.value)) out.push({ field: node.field, value });
  } else {
    for (const child of node.children) collect(child, out);
  }
  return out;
}

/**
 * A `(fieldId, value) => label` resolver for the values in `node`. Values of
 * fields with `loadOptions` not seen before are looked up once by asking the
 * loader for the value itself; until the answer lands the raw value is shown.
 */
export function useOptionLabels(
  fields: readonly FieldInput[],
  node: FilterNode | null | undefined,
): (fieldId: string, value: unknown) => string {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const typed = new Map<string, SheetbaseField>();
  for (const field of fields) if (typeof field !== "string") typed.set(field.id, field);

  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    const known = new Map<string, SheetbaseField>();
    for (const field of fields) if (typeof field !== "string") known.set(field.id, field);
    for (const { field: id, value } of collect(node)) {
      const field = known.get(id);
      const loader = field?.loadOptions;
      if (!field || !loader) continue;
      const key = String(value);
      if (labelsFor(loader).has(key)) continue;
      let seen = attempted.get(loader);
      if (!seen) {
        seen = new Set();
        attempted.set(loader, seen);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      loader(key)
        .then((options) => rememberOptions(field, options.filter((option) => option.value === key)))
        .catch(() => {});
    }
  }, [node, fields]);

  return (fieldId, value) => cachedOptionLabel(typed.get(fieldId), value) ?? String(value);
}
