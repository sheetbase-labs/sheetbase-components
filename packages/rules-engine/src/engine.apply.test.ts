import { describe, expect, it } from "vitest";
import { parseNaturalLanguageRule } from "./language";
import { ruleWritesForRows } from "./engine";
import type { PipelineRule, Row } from "./types";

const rule = (text: string, patch: Partial<PipelineRule> = {}): PipelineRule =>
  ({ ...parseNaturalLanguageRule(text), ...patch });

const recordIdOf = (row: Row) => (typeof row.id === "string" ? row.id : undefined);

describe("ruleWritesForRows", () => {
  it("emits one write per matched row per transformed field", () => {
    const rules = [rule("when status is failed then set status to triaged")];
    const rows: Row[] = [
      { id: "r1", status: "failed" },
      { id: "r2", status: "ok" },
      { id: "r3", status: "failed" },
    ];
    const plan = ruleWritesForRows(rules, rows, recordIdOf);
    expect(plan.matched).toBe(2);
    expect(plan.writes).toEqual([
      { recordId: "r1", fieldId: "status", before: "failed", after: "triaged" },
      { recordId: "r3", fieldId: "status", before: "failed", after: "triaged" },
    ]);
  });

  it("coerces before/after to strings, omitting before for absent fields", () => {
    const rules = [rule("when status is ok then set amount to 0")];
    const plan = ruleWritesForRows(rules, [{ id: "r1", status: "ok", amount: 150 }], recordIdOf);
    expect(plan.writes[0]).toEqual({ recordId: "r1", fieldId: "amount", before: "150", after: "0" });
    const added = ruleWritesForRows(rules, [{ id: "r1", status: "ok" }], recordIdOf);
    expect(added.writes[0]).toEqual({ recordId: "r1", fieldId: "amount", after: "0" });
  });

  it("counts matched rows that produce no transform writes", () => {
    const rules = [rule("when status is failed then flag needs-review")];
    const plan = ruleWritesForRows(rules, [{ id: "r1", status: "failed" }], recordIdOf);
    expect(plan.matched).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("omits writes that already hold the target value, so apply converges", () => {
    const rules = [rule("when status is failed then set triage to urgent")];
    const rows: Row[] = [
      { id: "r1", status: "failed" },                    // missing field — write
      { id: "r2", status: "failed", triage: "urgent" },  // satisfied — no write
      { id: "r3", status: "failed", triage: "low" },     // differs — write
    ];
    const plan = ruleWritesForRows(rules, rows, recordIdOf);
    expect(plan.matched).toBe(3);
    expect(plan.writes).toEqual([
      { recordId: "r1", fieldId: "triage", after: "urgent" },
      { recordId: "r3", fieldId: "triage", before: "low", after: "urgent" },
    ]);
    // A second pass over the applied output is empty — the fixpoint auto-apply relies on.
    const applied = rows.map((row) =>
      row.status === "failed" ? { ...row, triage: "urgent" } : row);
    expect(ruleWritesForRows(rules, applied, recordIdOf).writes).toHaveLength(0);
  });

  it("counts matched rows whose recordId cannot be resolved as skipped", () => {
    const rules = [rule("when status is failed then set status to triaged")];
    const rows: Row[] = [{ id: "r1", status: "failed" }, { status: "failed" }];
    const plan = ruleWritesForRows(rules, rows, recordIdOf);
    expect(plan.matched).toBe(2);
    expect(plan.skipped).toBe(1);
    expect(plan.writes).toHaveLength(1);
  });

  it("excludes rejected rows from writes and reports them", () => {
    const rules = [
      rule("when status is failed then set status to triaged"),
      rule("when status is failed then reject"),
    ];
    const plan = ruleWritesForRows(rules, [{ id: "r1", status: "failed" }], recordIdOf);
    expect(plan.matched).toBe(1);
    expect(plan.rejected).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("last transform wins when multiple matched rules write the same field", () => {
    const rules = [
      rule("when status is failed then set status to first", { priority: 1 }),
      rule("when status is failed then set status to second", { priority: 2 }),
    ];
    const plan = ruleWritesForRows(rules, [{ id: "r1", status: "failed" }], recordIdOf);
    expect(plan.writes).toEqual([
      { recordId: "r1", fieldId: "status", before: "failed", after: "second" },
    ]);
  });

  it("ignores disabled rules", () => {
    const rules = [rule("when status is failed then set status to triaged", { enabled: false })];
    const plan = ruleWritesForRows(rules, [{ id: "r1", status: "failed" }], recordIdOf);
    expect(plan.matched).toBe(0);
    expect(plan.writes).toHaveLength(0);
  });
});
