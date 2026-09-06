import { addressKey, parseAddress } from "./coordinates";
import type { FormulaBatchExecutor, FormulaTask } from "./calculation";
import { evaluateBytecode, lowerFormula, type BytecodeProgram } from "./bytecode";
import { assertValidName, compileFormula, normalizeName, normalizeNameTargetInput, type NamedRangeTarget } from "./formulas";
import { RangeStore } from "./range-store";
import { SpillStore, type SpillMatrix } from "./spill-store";
import { planRecalculation, type RecalculationPlan } from "./scheduler";
import type { CellBinding, CellFormat, Scalar } from "./types";

export type ExternalCellBinding = Extract<CellBinding, { kind: "record-field" | "query-result" }>;
export type BindingResolver = (binding: ExternalCellBinding) => Scalar;
export type ReferenceResolver = (qualifiedAddress: string) => Scalar;
export type FormulaNormalizer = (expression: string) => string;
export type FormulaMode = "evaluate" | "literal";
export type WorksheetOptions = Readonly<{ formulaMode?: FormulaMode }>;

export class Worksheet {
  readonly #cells = new Map<string, CellBinding>();
  readonly #dependents = new Map<string, Set<string>>();
  readonly #dependencies = new Map<string, Set<string>>();
  readonly #programs = new Map<string, BytecodeProgram>();
  readonly #programErrors = new Map<string, string>();
  readonly #names = new Map<string, string>();
  readonly #cache = new Map<string, Scalar>();
  readonly #dirty = new Set<string>();
  readonly formats = new RangeStore<CellFormat>();
  readonly spills = new SpillStore();
  #resolver?: BindingResolver;
  #referenceResolver?: ReferenceResolver;
  #formulaNormalizer?: FormulaNormalizer;
  #formulaMode: FormulaMode;

  constructor(
    resolver?: BindingResolver,
    referenceResolver?: ReferenceResolver,
    formulaNormalizer?: FormulaNormalizer,
    options?: WorksheetOptions,
  ) {
    this.#resolver = resolver;
    this.#referenceResolver = referenceResolver;
    this.#formulaNormalizer = formulaNormalizer;
    this.#formulaMode = options?.formulaMode ?? "evaluate";
  }

  setBindingResolver(resolver: BindingResolver): void {
    this.#resolver = resolver;
    this.invalidateAll();
  }

  setReferenceResolver(resolver: ReferenceResolver): void {
    this.#referenceResolver = resolver;
    this.invalidateAll();
  }

  /** Recompile formulas when structured-reference resolution changes. */
  renormalizeFormulas(): void {
    const formulas = [...this.#cells].filter((entry): entry is [string, Extract<CellBinding, { kind: "formula" }>] => entry[1].kind === "formula");
    for (const [address, binding] of formulas) this.set(address, binding);
  }

  /** Define a workbook-scoped name targeting a qualified range. Re-defining replaces. Names are case-insensitive and never collide with A1 addresses. */
  defineName(name: string, target: NamedRangeTarget | string): void {
    assertValidName(name);
    this.#names.set(normalizeName(name), normalizeNameTargetInput(target));
    this.renormalizeFormulas();
  }

  deleteName(name: string): void {
    if (this.#names.delete(normalizeName(name))) this.renormalizeFormulas();
  }

  /** Qualified target ("Sheet!A1:A20") for a defined name, or undefined. Lookup is case-insensitive. */
  resolveName(name: string): string | undefined {
    return this.#names.get(normalizeName(name));
  }

  /** Normalized addresses of cells holding formulas. */
  formulaAddresses(): readonly string[] {
    const result: string[] = [];
    for (const [address, binding] of this.#cells) if (binding.kind === "formula") result.push(address);
    return result;
  }

  set(address: string, binding: CellBinding | Scalar): void {
    const key = addressKey(parseAddress(address));
    const displaced = this.spills.clearAt(key);
    if (displaced) {
      for (const spilled of displaced.addresses) this.#cache.delete(spilled);
      if (displaced.owner !== key) this.#invalidateCascade(displaced.owner);
    }
    this.#invalidateCascade(key);
    this.#unlinkDependencies(key);
    this.#programs.delete(key);
    this.#programErrors.delete(key);
    const normalized: CellBinding = binding && typeof binding === "object" && "kind" in binding
      ? binding as CellBinding
      : { kind: "literal", value: binding as Scalar };
    this.#cells.set(key, normalized);
    if (normalized.kind === "formula") {
      let program: BytecodeProgram;
      try { program = lowerFormula(compileFormula(this.#formulaNormalizer?.(normalized.expression) ?? normalized.expression, this.#names)); }
      catch (error) {
        this.#programErrors.set(key, error instanceof Error ? error.message : "#VALUE!");
        return;
      }
      this.#programs.set(key, program);
      const formulaDependencies = new Set(program.dependencies);
      this.#dependencies.set(key, formulaDependencies);
      for (const dependency of formulaDependencies) {
        const dependents = this.#dependents.get(dependency) ?? new Set<string>();
        dependents.add(key);
        this.#dependents.set(dependency, dependents);
      }
    }
  }

  setInput(address: string, input: string): void {
    const trimmed = input.trim();
    if (trimmed.startsWith("=") && this.#formulaMode === "literal") {
      // Host-calculation authority: the "=" input is stored as inert text.
      // The host delivers the computed value through hydration instead.
      this.set(address, input);
      return;
    }
    if (trimmed.startsWith("=")) {
      this.set(address, { kind: "formula", expression: trimmed });
      return;
    }
    if (trimmed === "") {
      this.delete(address);
      return;
    }
    const numeric = Number(trimmed);
    this.set(address, Number.isFinite(numeric) && trimmed !== "" ? numeric : input);
  }

  setFormulaMode(mode: FormulaMode): void {
    if (this.#formulaMode === mode) return;
    this.#formulaMode = mode;
    for (const address of [...this.#cells.keys()]) this.setInput(address, this.input(address));
  }

  delete(address: string): void {
    const key = addressKey(parseAddress(address));
    this.#invalidateCascade(key);
    this.#unlinkDependencies(key);
    this.#programs.delete(key);
    this.#programErrors.delete(key);
    this.#cells.delete(key);
  }

  invalidate(address: string): void {
    this.#invalidateCascade(addressKey(parseAddress(address)));
  }

  invalidateAll(): void {
    this.#cache.clear();
    for (const key of this.#cells.keys()) this.#dirty.add(key);
  }

  dirtyCells(): readonly string[] {
    return [...this.#dirty];
  }

  recalculate(addresses: Iterable<string> = this.#dirty): ReadonlyMap<string, Scalar> {
    const calculated = new Map<string, Scalar>();
    const plan = this.recalculationPlan(addresses);
    if (plan.cyclic.length) throw new Error(`Circular reference at ${plan.cyclic[0]}`);
    for (const batch of plan.batches) {
      for (const address of batch) calculated.set(address, this.value(address));
    }
    return calculated;
  }

  async recalculateAsync(
    executor: FormulaBatchExecutor,
    addresses: Iterable<string> = this.#dirty,
  ): Promise<ReadonlyMap<string, Scalar>> {
    const calculated = new Map<string, Scalar>();
    const plan = this.recalculationPlan(addresses);
    if (plan.cyclic.length) throw new Error(`Circular reference at ${plan.cyclic[0]}`);

    for (const batch of plan.batches) {
      const tasks: FormulaTask[] = [];
      for (const address of batch) {
        const binding = this.#cells.get(address);
        if (binding?.kind !== "formula") {
          calculated.set(address, this.value(address));
          continue;
        }
        const programError = this.#programErrors.get(address);
        if (programError) throw new Error(programError);
        const inputs: Record<string, Scalar> = {};
        for (const dependency of this.#dependencies.get(address) ?? []) {
          inputs[dependency] = this.#resolveReference(dependency);
        }
        tasks.push({ address, program: this.#programs.get(address) ?? lowerFormula(compileFormula(binding.expression, this.#names)), inputs });
      }
      if (!tasks.length) continue;
      const results = await executor(tasks);
      const expected = new Set(tasks.map((task) => task.address));
      for (const result of results) {
        if (!expected.delete(result.address)) throw new Error(`Unexpected formula result for ${result.address}`);
        calculated.set(result.address, this.#rememberFormula(result.address, result.value));
      }
      if (expected.size) throw new Error(`Missing formula result for ${expected.values().next().value}`);
    }
    return calculated;
  }

  recalculationPlan(addresses: Iterable<string> = this.#dirty): RecalculationPlan {
    const normalized = [...addresses].map((address) => addressKey(parseAddress(address)));
    return planRecalculation(normalized, this.#dependencies);
  }

  dependencyAddresses(address: string): readonly string[] {
    return [...(this.#dependencies.get(addressKey(parseAddress(address))) ?? [])];
  }

  binding(address: string): CellBinding | undefined {
    return this.#cells.get(addressKey(parseAddress(address)));
  }

  input(address: string): string {
    const binding = this.binding(address);
    if (!binding) return "";
    if (binding.kind === "formula") return binding.expression;
    if (binding.kind === "literal") return binding.value === null ? "" : String(binding.value);
    return "";
  }

  value(address: string, stack = new Set<string>()): Scalar {
    const key = addressKey(parseAddress(address));
    if (stack.has(key)) throw new Error(`Circular reference at ${key}`);
    if (!this.#dirty.has(key) && this.#cache.has(key)) return this.#cache.get(key)!;
    const spilled = this.spills.value(key);
    if (spilled !== undefined) return spilled;
    const binding = this.#cells.get(key);
    if (!binding) return this.#remember(key, null);
    if (binding.kind === "literal") return this.#remember(key, binding.value);
    if (binding.kind === "record-field" || binding.kind === "query-result") {
      return this.#remember(key, this.#resolver?.(binding) ?? null);
    }
    const programError = this.#programErrors.get(key);
    if (programError) throw new Error(programError);
    stack.add(key);
    try {
      const program = this.#programs.get(key) ?? lowerFormula(compileFormula(binding.expression, this.#names));
      this.#programs.set(key, program);
      return this.#rememberFormula(key, evaluateBytecode(program, (dependency) => this.#resolveReference(dependency, stack)));
    } finally {
      stack.delete(key);
    }
  }

  dependents(address: string): readonly string[] {
    return [...(this.#dependents.get(addressKey(parseAddress(address))) ?? [])];
  }


  #unlinkDependencies(key: string): void {
    for (const dependency of this.#dependencies.get(key) ?? []) {
      const dependents = this.#dependents.get(dependency);
      dependents?.delete(key);
      if (dependents?.size === 0) this.#dependents.delete(dependency);
    }
    this.#dependencies.delete(key);
  }

  #remember(key: string, value: Scalar): Scalar {
    this.#cache.set(key, value);
    this.#dirty.delete(key);
    return value;
  }

  #rememberFormula(key: string, value: Scalar | SpillMatrix): Scalar {
    if (typeof value !== "object" || value === null || value instanceof Date || !("kind" in value) || value.kind !== "spill") {
      for (const address of this.spills.clearAnchor(key)) this.#cache.delete(address);
      return this.#remember(key, value as Scalar);
    }
    const cells = this.spills.write(key, value.values, (address) => this.#cells.has(address));
    for (const [address, cellValue] of cells) this.#remember(address, cellValue);
    return cells.get(key) ?? null;
  }

  #resolveReference(reference: string, stack = new Set<string>()): Scalar {
    return reference.includes("!") ? this.#referenceResolver?.(reference) ?? null : this.value(reference, stack);
  }

  #invalidateCascade(key: string): void {
    const queue = [key];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      this.#cache.delete(current);
      this.#dirty.add(current);
      for (const spilled of this.spills.clearAnchor(current)) {
        if (spilled !== current) queue.push(spilled);
      }
      for (const dependent of this.#dependents.get(current) ?? []) queue.push(dependent);
      if (!current.includes("!")) {
        // Defined names (and self-referential cross-sheet spellings) store dependents under a
        // qualified key ("Sheet!A2") while edits arrive under the local key ("A2"). The extra
        // matches only over-invalidate, never under-invalidate: every queued cell is recomputed.
        const suffix = `!${current}`;
        for (const [dependency, dependents] of this.#dependents) {
          if (dependency.endsWith(suffix)) for (const dependent of dependents) queue.push(dependent);
        }
      }
    }
  }
}
