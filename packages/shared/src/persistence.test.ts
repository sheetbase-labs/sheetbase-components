import { describe, expect, it } from "vitest";
import { createHttpAdapter, createMemoryAdapter, loadInitialState } from "./persistence";

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

describe("createHttpAdapter", () => {
  function fetcher(routes: Record<string, (init?: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }>) {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fn = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      const route = Object.keys(routes).find((prefix) => input.startsWith(prefix));
      if (!route) return { ok: false, status: 500, json: async () => ({}) };
      return routes[route]?.(init);
    };
    return { fn, calls };
  }

  it("loads via GET ?key= and saves via PUT {key,state}", async () => {
    const { fn, calls } = fetcher({
      "http://h/state?key=": () => ({ ok: true, status: 200, json: async () => ({ n: 4 }) }),
      "http://h/state": () => ({ ok: true, status: 200, json: async () => ({}) }),
    });
    const adapter = createHttpAdapter<{ n: number }>("http://h/state", fn);
    await expect(adapter.load("my key")).resolves.toEqual({ n: 4 });
    expect(calls[0]?.input).toBe("http://h/state?key=my%20key");
    await adapter.save("my key", { n: 4 });
    expect(calls[1]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ key: "my key", state: { n: 4 } });
  });

  it("treats 404 as nothing saved", async () => {
    const { fn } = fetcher({ "http://h/state": () => ({ ok: false, status: 404, json: async () => ({}) }) });
    await expect(createHttpAdapter("http://h/state", fn).load("k")).resolves.toBeUndefined();
  });

  it("throws labelled errors on other failures", async () => {
    const { fn } = fetcher({ "http://h/state": () => ({ ok: false, status: 500, json: async () => ({}) }) });
    const adapter = createHttpAdapter("http://h/state", fn, "Exploration");
    await expect(adapter.load("k")).rejects.toThrow("Exploration load failed (500)");
    await expect(adapter.save("k", {})).rejects.toThrow("Exploration save failed (500)");
  });
});
