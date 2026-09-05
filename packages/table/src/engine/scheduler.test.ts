import { describe, expect, it } from "vitest";
import { planRecalculation } from "./scheduler";
import {
  createLocalFormulaExecutor,
  evaluateFormulaTasks,
  programIdFor,
  stripCachedPrograms,
  type FormulaTask,
  type ProgramCache,
} from "./calculation";
import type { BytecodeProgram } from "./bytecode";

describe("planRecalculation", () => {
  it("groups independent work into stable dependency layers", () => {
    const graph = new Map([
      ["C1", new Set(["A1", "B1"])],
      ["D1", new Set(["C1"])],
      ["E1", new Set(["B1"])],
    ]);
    expect(planRecalculation(["E1", "D1", "C1", "B1", "A1"], graph)).toEqual({
      batches: [["A1", "B1"], ["C1", "E1"], ["D1"]],
      cyclic: [],
    });
  });

  it("treats clean dependencies as inputs and identifies cycles", () => {
    const graph = new Map([
      ["A1", new Set(["B1"])],
      ["B1", new Set(["A1"])],
      ["C1", new Set(["Z1"])],
    ]);
    expect(planRecalculation(["A1", "B1", "C1"], graph)).toEqual({
      batches: [["C1"]],
      cyclic: ["A1", "B1"],
    });
  });
});

describe("programIdFor", () => {
  it("is stable for identical programs and differs across source and dependencies", () => {
    const program: BytecodeProgram = { source: "=A1+1", instructions: [], dependencies: ["A1"] };
    expect(programIdFor(program)).toBe(
      programIdFor({ source: "=A1+1", instructions: [], dependencies: ["A1"] }),
    );
    expect(programIdFor(program)).not.toBe(
      programIdFor({ source: "=A1+2", instructions: [], dependencies: ["A1"] }),
    );
    expect(programIdFor(program)).not.toBe(
      programIdFor({ source: "=A1+1", instructions: [], dependencies: ["A2"] }),
    );
  });
});

describe("worker program transfer", () => {
  const programFor = (source: string): BytecodeProgram => ({
    source,
    instructions: [
      { op: "push", value: 1 },
      { op: "push", value: 2 },
      { op: "binary", operator: "+" },
    ],
    dependencies: [],
  });

  it("sends bytecode once; the second batch carries only program ids", () => {
    const sender: ProgramCache = new Map();
    const first = stripCachedPrograms(
      [{ address: "A1", program: programFor("=1+2"), inputs: {} }],
      sender,
    );
    expect(first[0].program).toBeDefined();
    expect(first[0].programId).toBe(programIdFor(programFor("=1+2")));

    const second = stripCachedPrograms(
      [{ address: "A1", program: programFor("=1+2"), inputs: {} }],
      sender,
    );
    expect(second[0].program).toBeUndefined();
    expect(second[0].programId).toBe(first[0].programId);
  });

  it("evaluates ref-only batches against the receiver cache with identical results", () => {
    const sender: ProgramCache = new Map();
    const receiver: ProgramCache = new Map();
    const batch = (address: string): FormulaTask[] => [
      { address, program: programFor("=1+2"), inputs: {} },
    ];
    const first = stripCachedPrograms(batch("A1"), sender);
    const second = stripCachedPrograms(batch("A1"), sender);
    expect(evaluateFormulaTasks(first, receiver)).toEqual(
      evaluateFormulaTasks(batch("A1"), new Map()),
    );
    expect(evaluateFormulaTasks(second, receiver)).toEqual([{ address: "A1", value: 3 }]);
  });

  it("fails a ref-only batch for an id the receiver never cached", () => {
    expect(() =>
      evaluateFormulaTasks([{ address: "A1", programId: "deadbeef", inputs: {} }], new Map()),
    ).toThrow('Unknown program "deadbeef"');
  });

  it("local executor accepts ref-only batches after the first send", async () => {
    const executor = createLocalFormulaExecutor();
    const program = programFor("=1+2");
    await expect(executor([{ address: "A1", program, inputs: {} }])).resolves.toEqual([
      { address: "A1", value: 3 },
    ]);
    await expect(
      executor([{ address: "A1", programId: programIdFor(program), inputs: {} }]),
    ).resolves.toEqual([{ address: "A1", value: 3 }]);
  });
});
