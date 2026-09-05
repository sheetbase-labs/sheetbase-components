import { addressKey, parseAddress } from "./coordinates";
import type { Scalar } from "./types";
import { callFunction } from "./functions";

export type ValueResolver = (address: string) => Scalar;
export type FormulaReference = Readonly<{ sheet?: string; address: string }>;
export type FormulaNode =
  | Readonly<{ kind: "literal"; value: Scalar }>
  | Readonly<{ kind: "reference"; reference: FormulaReference }>
  | Readonly<{ kind: "range"; start: FormulaReference; end: FormulaReference }>
  | Readonly<{ kind: "unary"; operator: "+" | "-"; operand: FormulaNode }>
  | Readonly<{ kind: "binary"; operator: string; left: FormulaNode; right: FormulaNode }>
  | Readonly<{ kind: "call"; name: string; arguments: readonly FormulaNode[] }>;
export type CompiledFormula = Readonly<{ source: string; root: FormulaNode; dependencies: readonly string[] }>;

const cellPattern = "\\$?[A-Z]+\\$?[1-9]\\d*";
const qualifiedReferencePattern = `(?:(?:'[^']+'|[A-Z_][A-Z0-9_.]*)!)?${cellPattern}`;

function cleanCell(reference: string): string { return reference.replace(/\$/g, "").toUpperCase(); }
function parseReference(value: string): FormulaReference {
  const separator = value.lastIndexOf("!");
  if (separator < 0) return { address: cleanCell(value) };
  const rawSheet = value.slice(0, separator);
  return { sheet: rawSheet.startsWith("'") ? rawSheet.slice(1, -1).replace(/''/g, "'") : rawSheet, address: cleanCell(value.slice(separator + 1)) };
}
function referenceKey(reference: FormulaReference): string { return reference.sheet ? `${reference.sheet}!${reference.address}` : reference.address; }

export type NamedRangeTarget = Readonly<{ sheet: string; range: string }>;
/** Name table for compileFormula: normalized name (uppercased) -> qualified target ("Sheet!A1:A20" or "Sheet!A1"). */
export type FormulaNameTable = ReadonlyMap<string, string>;

const namePattern = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const cellAddressCollision = /^[A-Z]+[0-9]+$/i;

export function normalizeName(name: string): string { return name.toUpperCase(); }

/** Workbook-scoped defined-name validation: identifier shape, never a bare A1 address. Re-defining replaces. */
export function assertValidName(name: string): void {
  if (!namePattern.test(name)) throw new Error(`Invalid name: ${name}`);
  if (cellAddressCollision.test(name)) throw new Error(`Name must not look like a cell address: ${name}`);
}

function quoteSheet(sheet: string): string {
  return /[^A-Za-z0-9_.]/.test(sheet) ? `'${sheet.replace(/'/g, "''")}'` : sheet;
}

function normalizeAddresses(range: string): string {
  const parts = range.split(":");
  if (parts.length > 2) throw new Error(`Invalid range: ${range}`);
  return parts.map((part) => addressKey(parseAddress(part.trim()))).join(":");
}

function normalizeQualifiedTarget(target: string): string {
  const separator = target.lastIndexOf("!");
  if (separator < 1) throw new Error(`Invalid name target: ${target}`);
  const rawSheet = target.slice(0, separator).trim();
  const sheet = rawSheet.startsWith("'") ? rawSheet.slice(1, -1).replace(/''/g, "'") : rawSheet;
  if (!sheet) throw new Error(`Invalid name target: ${target}`);
  return `${quoteSheet(sheet)}!${normalizeAddresses(target.slice(separator + 1))}`;
}

/** Normalize a { sheet, range } target to qualified "Sheet!A1:A20" form. A range that already carries a sheet prefix is used as-is. */
export function normalizeNameTarget(sheet: string, range: string): string {
  const text = range.trim();
  if (text.includes("!")) return normalizeQualifiedTarget(text);
  if (!sheet) throw new Error(`Invalid name target sheet: ${sheet}`);
  return `${quoteSheet(sheet)}!${normalizeAddresses(text)}`;
}

/** Accepts the { sheet, range } form or an already-qualified "Sheet!A1:A20" string. */
export function normalizeNameTargetInput(target: NamedRangeTarget | string): string {
  return typeof target === "string" ? normalizeQualifiedTarget(target) : normalizeNameTarget(target.sheet, target.range);
}

/** Expand a stored name target into reference/range AST nodes at compile time, so no new bytecode op is needed. */
function parseNameTarget(target: string): FormulaNode {
  const separator = target.lastIndexOf("!");
  if (separator < 1) throw new Error("#REF!");
  const prefix = target.slice(0, separator);
  const parts = target.slice(separator + 1).split(":");
  if (parts.length === 1) return { kind: "reference", reference: parseReference(`${prefix}!${parts[0]}`) };
  if (parts.length === 2) {
    return { kind: "range", start: parseReference(`${prefix}!${parts[0]}`), end: parseReference(`${prefix}!${parts[1]}`) };
  }
  throw new Error("#REF!");
}

function lookupName(names: FormulaNameTable | undefined, identifier: string): string | undefined {
  if (!names) return undefined;
  const direct = names.get(identifier);
  if (direct !== undefined) return direct;
  const upper = identifier.toUpperCase();
  if (upper !== identifier) {
    const hit = names.get(upper);
    if (hit !== undefined) return hit;
  }
  for (const [key, value] of names) {
    if (key !== identifier && key.toUpperCase() === upper) return value;
  }
  return undefined;
}
function numeric(value: Scalar): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received ${String(value)}`);
  return parsed;
}

export function compileFormula(expression: string, names?: FormulaNameTable): CompiledFormula {
  const source = expression.startsWith("=") ? expression.slice(1) : expression;
  const root = new FormulaCompiler(tokenize(source), names).parse();
  return { source: expression, root, dependencies: collectDependencies(root) };
}
export function dependencies(expression: string | CompiledFormula, names?: FormulaNameTable): readonly string[] {
  return typeof expression === "string" ? compileFormula(expression, names).dependencies : expression.dependencies;
}

/** Dependency discovery used while a user is still typing an incomplete formula. */
export function editableDependencies(expression: string, names?: FormulaNameTable): readonly string[] {
  try { return dependencies(expression, names); }
  catch { return []; }
}
export function evaluateFormula(expression: string, resolve: ValueResolver, names?: FormulaNameTable): Scalar {
  return evaluateCompiledFormula(compileFormula(expression, names), resolve);
}
export function evaluateCompiledFormula(program: CompiledFormula, resolve: ValueResolver): Scalar {
  return scalar(evaluateNode(program.root, resolve));
}

type RangeValue = Readonly<{ kind: "range-value"; start: FormulaReference; end: FormulaReference }>;
type FormulaValue = Scalar | RangeValue;

function evaluateNode(node: FormulaNode, resolve: ValueResolver): FormulaValue {
  if (node.kind === "literal") return node.value;
  if (node.kind === "reference") return resolve(referenceKey(node.reference));
  if (node.kind === "range") return { kind: "range-value", start: node.start, end: node.end };
  if (node.kind === "unary") {
    const value = numeric(scalar(evaluateNode(node.operand, resolve)));
    return node.operator === "-" ? -value : value;
  }
  if (node.kind === "binary") {
    const left = scalar(evaluateNode(node.left, resolve));
    const right = scalar(evaluateNode(node.right, resolve));
    if (node.operator === "&") return String(left ?? "") + String(right ?? "");
    if (node.operator === "+") return numeric(left) + numeric(right);
    if (node.operator === "-") return numeric(left) - numeric(right);
    if (node.operator === "*") return numeric(left) * numeric(right);
    if (node.operator === "/") { if (numeric(right) === 0) throw new Error("#DIV/0!"); return numeric(left) / numeric(right); }
    if (node.operator === "^") return numeric(left) ** numeric(right);
    if (node.operator === "=") return left === right;
    if (node.operator === "<>") return left !== right;
    if (node.operator === "<") return (left as string | number) < (right as string | number);
    if (node.operator === ">") return (left as string | number) > (right as string | number);
    if (node.operator === "<=") return (left as string | number) <= (right as string | number);
    if (node.operator === ">=") return (left as string | number) >= (right as string | number);
    throw new Error("#VALUE!");
  }
  if (node.name === "IF") {
    const condition = scalar(evaluateNode(node.arguments[0], resolve));
    return evaluateNode(condition ? node.arguments[1] : node.arguments[2] ?? { kind: "literal", value: false }, resolve);
  }
  if (node.name === "IFERROR") {
    try {
      return evaluateNode(node.arguments[0], resolve);
    } catch {
      return node.arguments[1] ? evaluateNode(node.arguments[1], resolve) : "";
    }
  }
  if (node.name === "ISERROR") {
    try {
      evaluateNode(node.arguments[0], resolve);
      return false;
    } catch {
      return true;
    }
  }
  // All other functions share one implementation with the bytecode evaluator.
  // A spilled result inside a non-spilling position fails like a range would.
  const output = callFunction(
    node.name,
    node.arguments.map((argument) => evaluateNode(argument, resolve)),
    { resolve },
  );
  if (typeof output === "object" && output !== null && "kind" in output && output.kind === "spill") {
    throw new Error("#VALUE!");
  }
  return output as Scalar;
}

function expand(value: FormulaValue, resolve: ValueResolver): Scalar[] {
  if (!isRange(value)) return [value];
  if (value.start.sheet !== value.end.sheet) throw new Error("#REF!");
  const start = parseAddress(value.start.address);
  const end = parseAddress(value.end.address);
  const values: Scalar[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column++) {
      values.push(resolve(referenceKey({ sheet: value.start.sheet, address: addressKey({ row, column }) })));
    }
  }
  return values;
}
function scalar(value: FormulaValue): Scalar { if (isRange(value)) throw new Error("#VALUE!"); return value; }
function isRange(value: FormulaValue): value is RangeValue {
  return typeof value === "object" && value !== null && !(value instanceof Date) && "kind" in value && value.kind === "range-value";
}
function collectDependencies(root: FormulaNode): readonly string[] {
  const result = new Set<string>();
  const visit = (node: FormulaNode): void => {
    if (node.kind === "reference") result.add(referenceKey(node.reference));
    else if (node.kind === "range") {
      if (node.start.sheet !== node.end.sheet) throw new Error("#REF!");
      const start = parseAddress(node.start.address);
      const end = parseAddress(node.end.address);
      for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
        for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column++) {
          result.add(referenceKey({ sheet: node.start.sheet, address: addressKey({ row, column }) }));
        }
      }
    } else if (node.kind === "unary") visit(node.operand);
    else if (node.kind === "binary") { visit(node.left); visit(node.right); }
    else if (node.kind === "call") node.arguments.forEach(visit);
  };
  visit(root);
  return [...result];
}

type TokenKind = "number" | "string" | "reference" | "identifier" | "operator" | "eof";
type Token = Readonly<{ kind: TokenKind; value: string; position: number }>;
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { position += whitespace[0].length; continue; }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) { tokens.push({ kind: "number", value: number[0], position }); position += number[0].length; continue; }
    if (rest[0] === '"') {
      let value = ""; let cursor = 1;
      while (cursor < rest.length) {
        if (rest[cursor] === '"' && rest[cursor + 1] === '"') { value += '"'; cursor += 2; continue; }
        if (rest[cursor] === '"') break;
        value += rest[cursor++];
      }
      if (rest[cursor] !== '"') throw new Error("#VALUE!");
      tokens.push({ kind: "string", value, position }); position += cursor + 1; continue;
    }
    const reference = new RegExp(`^${qualifiedReferencePattern}`, "i").exec(rest);
    // A trailing "(" always opens a function call: LOG10(1000) is the LOG10
    // function, never cell LOG10. Cell references are never followed by "(".
    if (reference && rest[reference[0].length] !== "(") { tokens.push({ kind: "reference", value: reference[0], position }); position += reference[0].length; continue; }
    const identifier = /^[A-Z_][A-Z0-9_.]*/i.exec(rest);
    if (identifier) { tokens.push({ kind: "identifier", value: identifier[0].toUpperCase(), position }); position += identifier[0].length; continue; }
    const operator = /^(<=|>=|<>|[+\-*/^(),:=<>&])/.exec(rest);
    if (operator) { tokens.push({ kind: "operator", value: operator[0], position }); position += operator[0].length; continue; }
    throw new Error("#VALUE!");
  }
  tokens.push({ kind: "eof", value: "", position });
  return tokens;
}

class FormulaCompiler {
  #index = 0;
  constructor(private readonly tokens: readonly Token[], private readonly names?: FormulaNameTable) {}
  parse(): FormulaNode { const root = this.#comparison(); this.#expect("eof"); return root; }
  #comparison(): FormulaNode { return this.#leftAssociative(() => this.#concatenation(), ["=", "<>", "<", ">", "<=", ">="]); }
  #concatenation(): FormulaNode { return this.#leftAssociative(() => this.#additive(), ["&"]); }
  #additive(): FormulaNode { return this.#leftAssociative(() => this.#multiplicative(), ["+", "-"]); }
  #multiplicative(): FormulaNode { return this.#leftAssociative(() => this.#power(), ["*", "/"]); }
  #power(): FormulaNode { const left = this.#unary(); if (this.#peek().value !== "^") return left; this.#next(); return { kind: "binary", operator: "^", left, right: this.#power() }; }
  #unary(): FormulaNode {
    if (["+", "-"].includes(this.#peek().value)) return { kind: "unary", operator: this.#next().value as "+" | "-", operand: this.#unary() };
    return this.#primary();
  }
  #primary(): FormulaNode {
    const token = this.#next();
    if (token.kind === "number") return { kind: "literal", value: Number(token.value) };
    if (token.kind === "string") return { kind: "literal", value: token.value };
    if (token.kind === "reference") {
      const start = parseReference(token.value);
      if (this.#peek().value !== ":") return { kind: "reference", reference: start };
      this.#next(); const end = this.#next();
      if (end.kind !== "reference") throw new Error("#REF!");
      const parsedEnd = parseReference(end.value);
      const endReference = parsedEnd.sheet || !start.sheet ? parsedEnd : { ...parsedEnd, sheet: start.sheet };
      return { kind: "range", start, end: endReference };
    }
    if (token.kind === "identifier") {
      if (token.value === "TRUE" || token.value === "FALSE") return { kind: "literal", value: token.value === "TRUE" };
      if (this.#peek().value !== "(") {
        const target = lookupName(this.names, token.value);
        if (target === undefined) throw new Error("#NAME?");
        return parseNameTarget(target);
      }
      this.#expect("operator", "("); const args: FormulaNode[] = [];
      if (this.#peek().value !== ")") { do { args.push(this.#comparison()); if (this.#peek().value !== ",") break; this.#next(); } while (true); }
      this.#expect("operator", ")"); return { kind: "call", name: token.value, arguments: args };
    }
    if (token.value === "(") { const value = this.#comparison(); this.#expect("operator", ")"); return value; }
    throw new Error("#VALUE!");
  }
  #leftAssociative(next: () => FormulaNode, operators: readonly string[]): FormulaNode {
    let value = next();
    while (operators.includes(this.#peek().value)) { const operator = this.#next().value; value = { kind: "binary", operator, left: value, right: next() }; }
    return value;
  }
  #peek(): Token { return this.tokens[this.#index]; }
  #next(): Token { return this.tokens[this.#index++]; }
  #expect(kind: TokenKind, value?: string): Token { const token = this.#next(); if (token.kind !== kind || (value !== undefined && token.value !== value)) throw new Error("#VALUE!"); return token; }
}
