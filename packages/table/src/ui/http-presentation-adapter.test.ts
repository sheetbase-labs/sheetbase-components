import { describe, expect, it } from "vitest";
import { createHttpPresentationAdapter } from "./presentation-state";

const saved = { version: 1, theme: "dark" };

describe("http presentation adapter", () => {
  it("loads saved state from the endpoint", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return { ok: true, status: 200, json: async () => saved };
    };
    const adapter = createHttpPresentationAdapter("/api/presentation", fetcher);
    await expect(adapter.load("sheetbase:one")).resolves.toMatchObject({ theme: "dark" });
    expect(calls[0]!.input).toBe("/api/presentation?key=sheetbase%3Aone");
  });

  it("treats a missing saved state as absent", async () => {
    const fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const adapter = createHttpPresentationAdapter("/api/presentation", fetcher);
    await expect(adapter.load("sheetbase:one")).resolves.toBeUndefined();
  });

  it("saves state with a PUT payload", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return { ok: true, status: 200, json: async () => ({ saved: true }) };
    };
    const adapter = createHttpPresentationAdapter("/api/presentation", fetcher);
    await adapter.save("sheetbase:one", saved as never);
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ key: "sheetbase:one", state: saved });
  });

  it("raises load and save failures instead of swallowing them", async () => {
    const failing = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(createHttpPresentationAdapter("/api/presentation", failing).load("k")).rejects.toThrow("Presentation load failed (500)");
    await expect(createHttpPresentationAdapter("/api/presentation", failing).save("k", saved as never)).rejects.toThrow("Presentation save failed (500)");
  });
});
