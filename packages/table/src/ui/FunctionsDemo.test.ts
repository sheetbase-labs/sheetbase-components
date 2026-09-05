import { describe, expect, it } from "vitest";
import { FUNCTION_NAMES } from "../engine/functions";
import { FUNCTION_DEMO_ENTRIES, evaluateDemoEntry } from "./FunctionsDemo";

describe("FunctionsDemo", () => {
  it("shows every registry function at least once", () => {
    const shown = new Set(FUNCTION_DEMO_ENTRIES.map((entry) => entry.fn));
    const missing = FUNCTION_NAMES.filter((name) => !shown.has(name));
    expect(missing).toEqual([]);
  });

  it("evaluates every demo entry without unknown-function errors", () => {
    const failures = FUNCTION_DEMO_ENTRIES.map((entry) => ({
      entry,
      result: evaluateDemoEntry(entry),
    })).filter(({ result }) => result.includes("#NAME?") || result === "#EMPTY!");
    expect(failures).toEqual([]);
  });
});
