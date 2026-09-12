import { describe, expect, it } from "vitest";
import { CURRENT_PRESENTATION_VERSION, createLocalStoragePresentationAdapter, normalisePresentationState, registerPresentationMigration, resolveTheme, type TablePresentationState } from "./presentation-state";

const fallback: TablePresentationState = {
  version: CURRENT_PRESENTATION_VERSION,
  theme: "light",
  conditionalFormats: [],
  formats: [],
  objects: [{ id: "rules", kind: "inspector", placement: "right", size: 292, open: false }],
  query: {},
  columns: [],
  frozenColumns: 0,
  views: [],
  annotations: [],
};

describe("table presentation state", () => {
  it("normalises partial and legacy values through the current schema", () => {
    expect(normalisePresentationState({ theme: "dark", rules: [{ operator: "isBlank", format: {} }], panelField: "status" }, fallback)).toMatchObject({
      version: CURRENT_PRESENTATION_VERSION,
      theme: "dark",
      conditionalFormats: [{ operator: "isBlank", format: {} }],
      objects: [{ open: true, context: { fieldId: "status" } }],
    });
  });
  it("keeps the system theme mode and falls back for unknown values", () => {
    expect(normalisePresentationState({ theme: "system" }, fallback)).toMatchObject({ theme: "system" });
    expect(normalisePresentationState({ theme: "midnight" }, fallback)).toMatchObject({ theme: "light" });
  });

  it("resolves system to light without a window", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("system")).toBe("light");
  });

  it("persists through the storage adapter without exposing storage to components", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } as Storage;
    const adapter = createLocalStoragePresentationAdapter(storage);
    adapter.save("sheet", { ...fallback, theme: "dark" });
    expect(adapter.load("sheet")).toMatchObject({ version: CURRENT_PRESENTATION_VERSION, theme: "dark" });
  });

  it("preserves query, layout, and named views as one presentation", () => {
    const view = { id: "review", name: "Needs review", query: { filters: [{ fieldId: "status", operator: "eq" as const, value: "Review" }] }, columns: [{ fieldId: "status" }], frozenColumns: 1, theme: "dark" as const, conditionalFormats: [], formats: [], objects: [] };
    const stored = normalisePresentationState({ ...fallback, query: view.query, columns: view.columns, frozenColumns: 1, views: [view], activeViewId: view.id }, fallback);
    expect(stored).toMatchObject({ activeViewId: "review", frozenColumns: 1, views: [{ name: "Needs review" }] });
  });

  it("guards against state written by a newer library version", () => {
    expect(normalisePresentationState({ version: CURRENT_PRESENTATION_VERSION + 1, theme: "dark" }, fallback)).toBe(fallback);
  });

  it("normalises annotations and drops malformed entries", () => {
    const stored = normalisePresentationState({
      ...fallback,
      annotations: [
        { address: "B2", text: "verified against lot record", author: "Reviewer", createdAt: "2026-09-03" },
        { address: "C3", text: "" },
        { text: "no address" },
        "junk",
      ],
    }, fallback);
    expect(stored.annotations).toEqual([
      { address: "B2", text: "verified against lot record", author: "Reviewer", createdAt: "2026-09-03" },
    ]);
  });

  it("migrates v1 stored state to v3 with an empty annotation overlay", () => {
    const migrated = normalisePresentationState({ version: 1, theme: "dark" }, fallback);
    expect(migrated).toMatchObject({ version: 3, annotations: [] });
  });

  it("migrates v2 stored state to v3 leaving annotations address-pinned", () => {
    const stored = {
      version: 2,
      theme: "dark",
      annotations: [{ address: "C5", text: "check this", author: "g" }],
    };
    const migrated = normalisePresentationState(stored, fallback);
    expect(migrated).toMatchObject({ version: 3 });
    expect(migrated.annotations).toEqual([{ address: "C5", text: "check this", author: "g" }]);
  });

  it("replays registered migrations for older stored versions", () => {
    registerPresentationMigration({
      from: 0,
      to: CURRENT_PRESENTATION_VERSION,
      migrate: (value) => ({ ...value, conditionalFormats: value.legacyRules, theme: value.theme }),
    });
    const migrated = normalisePresentationState({ version: 0, theme: "dark", legacyRules: [{ operator: "isBlank", format: {} }] }, fallback);
    expect(migrated).toMatchObject({ version: CURRENT_PRESENTATION_VERSION, theme: "dark", conditionalFormats: [{ operator: "isBlank" }] });
  });

  it("persists row heights keyed by row index, absent means auto", () => {
    expect(normalisePresentationState({ ...fallback, rowHeights: { 0: 44, 5: 60 } }, fallback))
      .toMatchObject({ rowHeights: { 0: 44, 5: 60 } });
    expect(normalisePresentationState({ ...fallback }, { ...fallback, rowHeights: undefined }).rowHeights)
      .toBeUndefined();
    expect(normalisePresentationState({ ...fallback, rowHeights: { 2: 40 } }, { ...fallback, rowHeights: { 2: 40 } }).rowHeights)
      .toEqual({ 2: 40 });
  });

  it("drops malformed row heights and keeps the rest", () => {
    const stored = normalisePresentationState({
      ...fallback,
      rowHeights: { 0: 44, 1: 0, 2: -5, 3: Number.NaN, 4: "tall", 5: Number.POSITIVE_INFINITY },
    }, fallback);
    expect(stored.rowHeights).toEqual({ 0: 44 });
    expect(normalisePresentationState({ ...fallback, rowHeights: [44] }, fallback).rowHeights).toBeUndefined();
  });

});
