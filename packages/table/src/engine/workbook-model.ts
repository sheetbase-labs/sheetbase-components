import { addressKey, parseAddress } from "./coordinates";
import { assertValidName, compileFormula, normalizeName, normalizeNameTargetInput, type NamedRangeTarget } from "./formulas";
import type { CellBinding, Scalar } from "./types";
import { Worksheet, type BindingResolver } from "./workbook";

function qualified(sheet: string, address: string): string {
  return `${sheet}!${addressKey(parseAddress(address))}`;
}

function splitQualified(reference: string): [string, string] {
  const separator = reference.lastIndexOf("!");
  if (separator < 1) throw new Error(`Invalid qualified reference: ${reference}`);
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

/** Owns sheet identity and dependency edges that cross worksheet boundaries. */
export class Workbook {
  readonly #sheets = new Map<string, Worksheet>();
  readonly #dependencies = new Map<string, Set<string>>();
  readonly #dependents = new Map<string, Set<string>>();
  readonly #evaluationStack = new Set<string>();
  readonly #names = new Map<string, string>();

  constructor(readonly bindingResolver?: BindingResolver) {}

  addSheet(name: string): Worksheet {
    if (!name || name.includes("!")) throw new Error("Invalid sheet name");
    if (this.#sheets.has(name)) throw new Error(`Sheet already exists: ${name}`);
    const sheet = new Worksheet(this.bindingResolver, (reference) => this.value(...splitQualified(reference)));
    for (const [defined, target] of this.#names) sheet.defineName(defined, target);
    this.#sheets.set(name, sheet);
    return sheet;
  }

  sheet(name: string): Worksheet {
    const sheet = this.#sheets.get(name);
    if (!sheet) throw new Error(`Unknown sheet: ${name}`);
    return sheet;
  }

  set(sheetName: string, address: string, binding: CellBinding | Scalar): void {
    const key = qualified(sheetName, address);
    this.#unlink(key);
    this.sheet(sheetName).set(address, binding);
    if (binding && typeof binding === "object" && "kind" in binding && binding.kind === "formula") {
      this.#link(sheetName, key, binding.expression);
    }
    this.#invalidateCascade(key);
  }

  /** Define a workbook-scoped name. Re-defining replaces. Case-insensitive, never an A1 address. */
  defineName(name: string, target: NamedRangeTarget | string): void {
    assertValidName(name);
    const normalized = normalizeNameTargetInput(target);
    this.#names.set(normalizeName(name), normalized);
    for (const sheet of this.#sheets.values()) sheet.defineName(name, normalized);
    this.#relinkAll();
  }

  deleteName(name: string): void {
    if (!this.#names.delete(normalizeName(name))) return;
    for (const sheet of this.#sheets.values()) sheet.deleteName(name);
    this.#relinkAll();
  }

  /** Qualified target ("Sheet!A1:A20") for a defined name, or undefined. Lookup is case-insensitive. */
  resolveName(name: string): string | undefined {
    return this.#names.get(normalizeName(name));
  }

  #link(sheetName: string, key: string, expression: string): void {
    const dependencies = new Set(compileFormula(expression, this.#names).dependencies.map((dependency) =>
      dependency.includes("!") ? dependency : qualified(sheetName, dependency)));
    this.#dependencies.set(key, dependencies);
    for (const dependency of dependencies) {
      const dependents = this.#dependents.get(dependency) ?? new Set<string>();
      dependents.add(key);
      this.#dependents.set(dependency, dependents);
    }
  }

  /** Rebuild cross-sheet edges after the name table changes. Formulas that no longer compile (deleted names) keep their sheet-level program error and contribute no edges. */
  #relinkAll(): void {
    this.#dependencies.clear();
    this.#dependents.clear();
    for (const [sheetName, sheet] of this.#sheets) {
      for (const address of sheet.formulaAddresses()) {
        const binding = sheet.binding(address);
        if (binding?.kind !== "formula") continue;
        try {
          this.#link(sheetName, `${sheetName}!${address}`, binding.expression);
        } catch {
        }
      }
    }
  }

  setInput(sheetName: string, address: string, input: string): void {
    const trimmed = input.trim();
    if (!trimmed) { this.delete(sheetName, address); return; }
    if (trimmed.startsWith("=")) { this.set(sheetName, address, { kind: "formula", expression: trimmed }); return; }
    const numeric = Number(trimmed);
    this.set(sheetName, address, Number.isFinite(numeric) ? numeric : input);
  }

  delete(sheetName: string, address: string): void {
    const key = qualified(sheetName, address);
    this.#unlink(key);
    this.sheet(sheetName).delete(address);
    this.#invalidateCascade(key);
  }

  value(sheetName: string, address: string): Scalar {
    const key = qualified(sheetName, address);
    if (this.#evaluationStack.has(key)) throw new Error(`Circular reference at ${key}`);
    this.#evaluationStack.add(key);
    try { return this.sheet(sheetName).value(address); }
    finally { this.#evaluationStack.delete(key); }
  }

  #unlink(key: string): void {
    for (const dependency of this.#dependencies.get(key) ?? []) {
      const dependents = this.#dependents.get(dependency);
      dependents?.delete(key);
      if (dependents?.size === 0) this.#dependents.delete(dependency);
    }
    this.#dependencies.delete(key);
  }

  #invalidateCascade(key: string): void {
    const queue = [key];
    const seen = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const [sheet, address] = splitQualified(current);
      this.#sheets.get(sheet)?.invalidate(address);
      for (const dependent of this.#dependents.get(current) ?? []) queue.push(dependent);
    }
  }
}
