import { addressKey, parseAddress } from "./coordinates";
import type { CompiledFormula, FormulaNode, FormulaReference, ValueResolver } from "./formulas";
import type { Scalar } from "./types";
import type { SpillMatrix } from "./spill-store";
import { callFunction, type FunctionArg } from "./functions";

export type FormulaInstruction =
  | Readonly<{ op: "push"; value: Scalar }>
  | Readonly<{ op: "reference"; reference: FormulaReference }>
  | Readonly<{ op: "range"; start: FormulaReference; end: FormulaReference }>
  | Readonly<{ op: "unary"; operator: "+" | "-" }>
  | Readonly<{ op: "binary"; operator: string }>
  | Readonly<{ op: "call"; name: string; argumentCount: number }>
  | Readonly<{ op: "jump-if-false"; target: number }>
  | Readonly<{ op: "jump"; target: number }>
  | Readonly<{ op: "drop" }>
  /** Lazy error boundary (IFERROR/ISERROR): errors raised after `target`'s
   * origin jump to `target` with the stack restored to `depth`. */
  | Readonly<{ op: "catch"; target: number; depth: number }>
  | Readonly<{ op: "uncatch" }>;

export type BytecodeProgram = Readonly<{
  source: string;
  instructions: readonly FormulaInstruction[];
  dependencies: readonly string[];
}>;

type RangeOperand = Readonly<{ kind: "range" | "range-value"; start: FormulaReference; end: FormulaReference }>;
type Operand = Scalar | RangeOperand | SpillMatrix;
export type FormulaOutput = Scalar | SpillMatrix;

export function lowerFormula(program: CompiledFormula): BytecodeProgram {
  const instructions: FormulaInstruction[] = [];
  emit(program.root, instructions, { depth: 0 });
  return { source: program.source, instructions, dependencies: program.dependencies };
}

interface EmitContext { depth: number }

function emitOp(output: FormulaInstruction[], ctx: EmitContext, instruction: FormulaInstruction): void {
  output.push(instruction);
  switch (instruction.op) {
    case "push":
    case "reference":
    case "range":
      ctx.depth += 1;
      break;
    case "binary":
    case "jump-if-false":
    case "drop":
      ctx.depth -= 1;
      break;
    case "call":
      ctx.depth += 1 - instruction.argumentCount;
      break;
    default:
      break;
  }
}

function emit(node: FormulaNode, output: FormulaInstruction[], ctx: EmitContext): void {
  if (node.kind === "literal") emitOp(output, ctx, { op: "push", value: node.value });
  else if (node.kind === "reference") emitOp(output, ctx, { op: "reference", reference: node.reference });
  else if (node.kind === "range") emitOp(output, ctx, { op: "range", start: node.start, end: node.end });
  else if (node.kind === "unary") {
    emit(node.operand, output, ctx);
    emitOp(output, ctx, { op: "unary", operator: node.operator });
  } else if (node.kind === "binary") {
    emit(node.left, output, ctx);
    emit(node.right, output, ctx);
    emitOp(output, ctx, { op: "binary", operator: node.operator });
  } else if (node.name === "IF") {
    emit(node.arguments[0], output, ctx);
    const branch = output.push({ op: "jump-if-false", target: -1 }) - 1;
    ctx.depth -= 1;
    const joinDepth = ctx.depth;
    emit(node.arguments[1] ?? { kind: "literal", value: false }, output, ctx);
    const end = output.push({ op: "jump", target: -1 }) - 1;
    const afterTrue = ctx.depth;
    ctx.depth = joinDepth;
    output[branch] = { op: "jump-if-false", target: output.length };
    emit(node.arguments[2] ?? { kind: "literal", value: false }, output, ctx);
    output[end] = { op: "jump", target: output.length };
    ctx.depth = afterTrue;
  } else if (node.name === "IFERROR") {
    emitErrorGuard(node, output, ctx, () => {
      emit(node.arguments[1] ?? { kind: "literal", value: "" }, output, ctx);
    });
  } else if (node.name === "ISERROR") {
    emitErrorGuard(node, output, ctx, () => {
      emitOp(output, ctx, { op: "push", value: true });
    });
  } else {
    node.arguments.forEach((argument) => emit(argument, output, ctx));
    emitOp(output, ctx, { op: "call", name: node.name, argumentCount: node.arguments.length });
  }
}

/** IFERROR keeps the guarded value or the fallback. ISERROR replaces it with a boolean. */
function emitErrorGuard(
  node: Extract<FormulaNode, { kind: "call" }>,
  output: FormulaInstruction[],
  ctx: EmitContext,
  onCatch: () => void,
): void {
  const depth = ctx.depth;
  const catchInstruction = output.push({ op: "catch", target: -1, depth }) - 1;
  emit(node.arguments[0], output, ctx);
  output.push({ op: "uncatch" });
  if (node.name === "ISERROR") {
    emitOp(output, ctx, { op: "drop" });
    emitOp(output, ctx, { op: "push", value: false });
  }
  const jump = output.push({ op: "jump", target: -1 }) - 1;
  const afterSuccess = ctx.depth;
  ctx.depth = depth;
  output[catchInstruction] = { op: "catch", target: output.length, depth };
  onCatch();
  output[jump] = { op: "jump", target: output.length };
  ctx.depth = afterSuccess;
}

interface CatchHandler {
  from: number;
  target: number;
  depth: number;
}

export function evaluateBytecode(program: BytecodeProgram, resolve: ValueResolver): FormulaOutput {
  const stack: Operand[] = [];
  const handlers: CatchHandler[] = [];
  let pointer = 0;
  while (pointer < program.instructions.length) {
    const instruction = program.instructions[pointer];
    try {
      if (instruction.op === "push") stack.push(instruction.value);
      else if (instruction.op === "reference") stack.push(resolve(key(instruction.reference)));
      else if (instruction.op === "range") stack.push({ kind: "range", start: instruction.start, end: instruction.end });
      else if (instruction.op === "unary") {
        const value = number(scalar(stack.pop()));
        stack.push(instruction.operator === "-" ? -value : value);
      } else if (instruction.op === "binary") {
        const right = scalar(stack.pop());
        const left = scalar(stack.pop());
        stack.push(binary(instruction.operator, left, right));
      } else if (instruction.op === "jump-if-false") {
        if (!scalar(stack.pop())) pointer = instruction.target - 1;
      }       else if (instruction.op === "jump") pointer = instruction.target - 1;
      else if (instruction.op === "drop") stack.pop();
      else if (instruction.op === "catch") {
        handlers.push({ from: pointer + 1, target: instruction.target, depth: instruction.depth });
      } else if (instruction.op === "uncatch") {
        handlers.pop();
      } else {
        const args = stack.splice(stack.length - instruction.argumentCount, instruction.argumentCount);
        stack.push(call(instruction.name, args as FunctionArg[], resolve));
      }
    } catch (error) {
      let handlerIndex = -1;
      for (let index = handlers.length - 1; index >= 0; index--) {
        if (handlers[index].from <= pointer) {
          handlerIndex = index;
          break;
        }
      }
      if (handlerIndex < 0) throw error;
      const handler = handlers[handlerIndex];
      handlers.length = handlerIndex;
      stack.length = handler.depth;
      pointer = handler.target - 1;
    }
    pointer += 1;
  }
  if (stack.length !== 1) throw new Error("#VALUE!");
  if (isRange(stack[0])) return expandMatrix(stack[0], resolve);
  return isSpill(stack[0]) ? stack[0] : scalar(stack[0]);
}

function key(reference: FormulaReference): string { return reference.sheet ? `${reference.sheet}!${reference.address}` : reference.address; }
function scalar(value: Operand | undefined): Scalar {
  if (value === undefined || isRange(value) || isSpill(value)) throw new Error("#VALUE!");
  return value;
}
function isSpill(value: Operand): value is SpillMatrix {
  return typeof value === "object" && value !== null && !(value instanceof Date) && "kind" in value && value.kind === "spill";
}
function isRange(value: Operand): value is RangeOperand {
  return typeof value === "object" && value !== null && !(value instanceof Date) && "kind" in value && (value.kind === "range" || value.kind === "range-value");
}
function number(value: Scalar): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("#VALUE!");
  return parsed;
}
function binary(operator: string, left: Scalar, right: Scalar): Scalar {
  if (operator === "&") return String(left ?? "") + String(right ?? "");
  if (operator === "+") return number(left) + number(right);
  if (operator === "-") return number(left) - number(right);
  if (operator === "*") return number(left) * number(right);
  if (operator === "/") { if (number(right) === 0) throw new Error("#DIV/0!"); return number(left) / number(right); }
  if (operator === "^") return number(left) ** number(right);
  if (operator === "=") return left === right;
  if (operator === "<>") return left !== right;
  if (operator === "<") return (left as string | number) < (right as string | number);
  if (operator === ">") return (left as string | number) > (right as string | number);
  if (operator === "<=") return (left as string | number) <= (right as string | number);
  if (operator === ">=") return (left as string | number) >= (right as string | number);
  throw new Error("#VALUE!");
}
function expandMatrix(value: RangeOperand, resolve: ValueResolver): SpillMatrix {
  if (value.start.sheet !== value.end.sheet) throw new Error("#REF!");
  const start = parseAddress(value.start.address);
  const end = parseAddress(value.end.address);
  const values: Scalar[][] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
    const outputRow: Scalar[] = [];
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column++) {
      outputRow.push(resolve(key({ sheet: value.start.sheet, address: addressKey({ row, column }) })));
    }
    values.push(outputRow);
  }
  return { kind: "spill", values };
}
function call(name: string, args: Operand[], resolve: ValueResolver): FormulaOutput {
  return callFunction(name, args, { resolve });
}
