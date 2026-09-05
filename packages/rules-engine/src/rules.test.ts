import { describe, expect, it } from "vitest";
import { parseNaturalLanguageRule, RuleParseError } from "./language";
import { applyActions, dryRunRule, evaluateRule, matchRules } from "./engine";

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

describe("parse failures and suffixes", () => {
  it("throws instead of inventing a contains clause", () => {
    expect(() => parseNaturalLanguageRule("please do the thing")).toThrow(RuleParseError);
  });

  it("keeps endsWith suffixes as text", () => {
    const rule = parseNaturalLanguageRule('when sku ends with 001 then flag');
    expect(rule.conditions[0]).toMatchObject({ operator: "endsWith", value: "001" });
  });
});

describe("applyActions", () => {
  it("applies transform and reject effects", () => {
    const transform = parseNaturalLanguageRule("when amount is greater than 100 then set status to review");
    const reject = parseNaturalLanguageRule("when amount is greater than 100 then reject");
    const effects = applyActions({ amount: 150, status: "ok" }, [transform, reject]);
    expect(effects.rejected).toBe(true);
    expect(effects.output.status).toBe("review");
    expect(effects.transforms.status).toBe("review");
  });
});
