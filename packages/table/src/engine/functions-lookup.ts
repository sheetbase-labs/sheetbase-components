import type { Scalar } from "./types";
import type { FunctionImpl } from "./functions-runtime";
import {
  boolean,
  columnName,
  conditionalCount,
  conditionalCountIfs,
  conditionalSum,
  conditionalSumIfs,
  matrixOf,
  number,
  scalarOf,
} from "./functions-runtime";

export const LOOKUP_FUNCTIONS: Record<string, FunctionImpl> = {
  // --- criteria aggregation ---
  SUMIF: (args, ctx) => conditionalSum(args, ctx, "sum"),
  AVERAGEIF: (args, ctx) => conditionalSum(args, ctx, "average"),
  COUNTIF: (args, ctx) => conditionalCount(args, ctx)[0],
  SUMIFS: (args, ctx) => conditionalSumIfs(args, ctx, "sum"),
  AVERAGEIFS: (args, ctx) => conditionalSumIfs(args, ctx, "average"),
  COUNTIFS: (args, ctx) => conditionalCountIfs(args, ctx),

  // --- lookup ---
  VLOOKUP: (args, ctx) => {
    const lookup = scalarOf(args[0]);
    const rows = matrixOf(args[1], ctx);
    const columnIndex = Math.trunc(number(scalarOf(args[2])));
    const index = rows.findIndex((row) => (row[0] ?? null) === lookup);
    return index >= 0 ? rows[index]?.[columnIndex - 1] ?? null : "#N/A";
  },
  HLOOKUP: (args, ctx) => {
    const lookup = scalarOf(args[0]);
    const rows = matrixOf(args[1], ctx);
    const rowIndex = Math.trunc(number(scalarOf(args[2])));
    const header = rows[0] ?? [];
    const index = header.indexOf(lookup);
    return index >= 0 ? rows[rowIndex - 1]?.[index] ?? null : "#N/A";
  },
  INDEX: (args, ctx) => {
    const rows = matrixOf(args[0], ctx);
    const row = args[1] === undefined ? undefined : Math.trunc(number(scalarOf(args[1])));
    const column = args[2] === undefined ? undefined : Math.trunc(number(scalarOf(args[2])));
    if (row === undefined) throw new Error("#VALUE!");
    if (column === undefined && rows.length === 1) return rows[0]?.[row - 1] ?? null;
    if (column === undefined && (rows[0]?.length ?? 0) === 1) return rows[row - 1]?.[0] ?? null;
    if (column === undefined) throw new Error("#REF!");
    return rows[row - 1]?.[column - 1] ?? null;
  },
  CHOOSE: (args) => {
    const index = Math.trunc(number(scalarOf(args[0])));
    const chosen = args[index];
    return chosen === undefined ? "#VALUE!" : scalarOf(chosen);
  },
  ROWS: (args, ctx) => matrixOf(args[0], ctx).length,
  COLUMNS: (args, ctx) => matrixOf(args[0], ctx)[0]?.length ?? 0,
  ADDRESS: (args) => {
    const row = Math.trunc(number(scalarOf(args[0])));
    const column = Math.trunc(number(scalarOf(args[1])));
    const absolute = args[2] === undefined ? 1 : Math.trunc(number(scalarOf(args[2])));
    if (row < 1 || column < 1) throw new Error("#VALUE!");
    const rowLock = absolute === 1 || absolute === 2 ? "$" : "";
    const columnLock = absolute === 1 || absolute === 3 ? "$" : "";
    return `${columnLock}${columnName(column)}${rowLock}${row}`;
  },
  TRANSPOSE: (args, ctx) => {
    const rows = matrixOf(args[0], ctx);
    const transposed: Scalar[][] = [];
    for (const row of rows) {
      row.forEach((value, index) => {
        transposed[index] ??= [];
        transposed[index].push(value);
      });
    }
    return { kind: "spill", values: transposed };
  },
  FILTER: (args, ctx) => {
    const rows = matrixOf(args[0], ctx);
    const include = matrixOf(args[1], ctx);
    const flags = include.flat();
    const filtered = rows.filter((_, index) => boolean(flags[index] ?? false));
    if (filtered.length === 0) {
      if (args[2] !== undefined) return scalarOf(args[2]);
      throw new Error("#CALC!");
    }
    return { kind: "spill", values: filtered };
  },
};
