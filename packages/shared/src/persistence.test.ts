import { describe, expect, it } from "vitest";
import { createMemoryAdapter, loadInitialState } from "./persistence";

describe("createMemoryAdapter", () => {
  it("round-trips a value by key", () => {
    const adapter = createMemoryAdapter<{ n: number }>();
    adapter.save("graph", { n: 3 });
    expect(adapter.load("graph")).toEqual({ n: 3 });
    expect(adapter.load("missing")).toBeUndefined();
  });
});

describe("loadInitialState", () => {
  it("returns fallback when no adapter or key is provided", () => {
    expect(loadInitialState(undefined, undefined, { ok: true })).toEqual({ ok: true });
  });

  it("returns stored state for a sync adapter", () => {
    const adapter = createMemoryAdapter<{ ok: boolean }>();
    adapter.save("rules", { ok: true });
    expect(loadInitialState("rules", adapter, { ok: false })).toEqual({ ok: true });
  });
});
