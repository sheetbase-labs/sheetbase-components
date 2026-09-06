import { describe, expect, it } from "vitest";
import { AsyncFunctionRegistry, QUERY_RECORDS_CAPABILITY } from "./async-functions";
import type { FunctionContext } from "./functions";

const ctx: FunctionContext = { resolve: () => null };

describe("AsyncFunctionRegistry", () => {
  it("blocks the built-in QUERYRECORDS stub by default", async () => {
    const registry = new AsyncFunctionRegistry();
    expect(registry.has("QUERYRECORDS")).toBe(true);
    expect(registry.capabilityFor("QUERYRECORDS")).toBe(QUERY_RECORDS_CAPABILITY);
    expect(registry.isCapabilityGranted(QUERY_RECORDS_CAPABILITY)).toBe(false);
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
  });

  it("executes QUERYRECORDS once the capability is granted", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.grant(QUERY_RECORDS_CAPABILITY);
    expect(registry.isCapabilityGranted(QUERY_RECORDS_CAPABILITY)).toBe(true);
    await expect(registry.call("queryrecords", [], ctx)).resolves.toBeNull();
  });

  it("re-blocks after revoke", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.grant(QUERY_RECORDS_CAPABILITY);
    registry.revoke(QUERY_RECORDS_CAPABILITY);
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
  });

  it("rejects unknown names with #NAME?", async () => {
    const registry = new AsyncFunctionRegistry();
    expect(registry.has("NOPE")).toBe(false);
    expect(registry.get("NOPE")).toBeUndefined();
    await expect(registry.call("NOPE", [], ctx)).rejects.toThrow("#NAME?");
  });

  it("runs capability-less host functions without a grant", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("DOUBLE-IT", async (args) =>
      typeof args[0] === "number" ? args[0] * 2 : "#VALUE!",
    );
    expect(registry.capabilityFor("DOUBLE-IT")).toBeUndefined();
    await expect(registry.call("double-it", [21], ctx)).resolves.toBe(42);
  });

  it("lets hosts replace the stub with real transport under the same gate", async () => {
    const registry = new AsyncFunctionRegistry();
    registry.register("QUERYRECORDS", async () => "host-rows", {
      capability: QUERY_RECORDS_CAPABILITY,
    });
    await expect(registry.call("QUERYRECORDS", [], ctx)).rejects.toThrow("#BLOCKED!");
    registry.grant(QUERY_RECORDS_CAPABILITY);
    await expect(registry.call("QUERYRECORDS", [], ctx)).resolves.toBe("host-rows");
  });
});
