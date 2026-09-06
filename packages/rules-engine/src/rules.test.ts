import { describe, expect, it } from "vitest";
import { parseNaturalLanguageRule } from "./language";
import { dryRunRule, evaluateRule, matchRules } from "./engine";

describe("parseNaturalLanguageRule", () => {
  it("parses when/then with comparison + route", () => {
    const rule = parseNaturalLanguageRule("when amount is greater than 5000 then route to review-queue");
    expect(rule.conditions).toEqual([{ field: "amount", operator: "gt", value: 5000 }]);
    expect(rule.actions).toEqual([{ kind: "route", target: "review-queue" }]);
  });

  it("parses OR clauses into any-match", () => {
    const rule = parseNaturalLanguageRule("if status is failed or status is blocked then flag for review");
    expect(rule.when).toBe("any");
    expect(rule.conditions).toHaveLength(2);
  });

  it("parses reject-rows-where form", () => {
    const rule = parseNaturalLanguageRule("reject rows where email is empty");
    expect(rule.conditions[0]).toMatchObject({ field: "email", operator: "isEmpty" });
    expect(rule.actions.some((a) => a.kind === "reject")).toBe(true);
  });
});

describe("evaluateRule", () => {
  it("matches numeric comparison case-insensitively on fields", () => {
    const rule = parseNaturalLanguageRule("when Amount is greater than 100 then flag");
    expect(evaluateRule(rule, { amount: 150 })).toBe(true);
    expect(evaluateRule(rule, { Amount: 50 })).toBe(false);
  });

  it("orders matches by priority", () => {
    const low = { ...parseNaturalLanguageRule("when x is 1 then flag"), priority: 1, name: "b" };
    const high = { ...parseNaturalLanguageRule("when x is 1 then flag"), priority: 99, name: "a" };
    expect(matchRules([high, low], { x: 1 }).map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("dry-runs via filterRows for a numeric Amount rule", () => {
    const rule = parseNaturalLanguageRule("when Amount is greater than 100 then flag");
    expect(dryRunRule(rule, [{ amount: 150 }, { amount: 50 }]).map((r) => r.amount)).toEqual([150]);
  });
});
