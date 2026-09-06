import { bench, describe } from "vitest";
import { compileFormula, evaluateBytecode, evaluateCompiledFormula, evaluateFormula, lowerFormula, planRecalculation, RangeStore, Worksheet } from "../engine";
import { applyCellMutation, cellMutation } from "../grid/mutations";
import { HttpPagedDataAdapter, DataPageCache, ViewportPageLoader } from "../data";

const largeSheet = new Map<string, string>();
for (let row = 1; row <= 100_000; row++) largeSheet.set(`A${row}`, String(row));
const editedSheet = new Map(largeSheet);
editedSheet.set("A50000", "changed");
const scopedSingleEdit = cellMutation("Edit cell", largeSheet, editedSheet, ["A50000"]);

describe("large sparse sheet", () => {
  bench("create a one-cell mutation across 100k populated cells", () => {
    cellMutation("Edit cell", largeSheet, editedSheet);
  });

  bench("create a scoped one-cell mutation", () => {
    cellMutation("Edit cell", largeSheet, editedSheet, ["A50000"]);
  });

  bench("apply a one-cell mutation to 100k populated cells", () => {
    applyCellMutation(largeSheet, scopedSingleEdit);
  });
});

describe("formula recalculation", () => {
  const worksheet = new Worksheet();
  for (let row = 1; row <= 500; row++) worksheet.setInput(`A${row}`, String(row));
  worksheet.setInput("B1", "=SUM(A1:A500)");

  bench("evaluate a 500-cell aggregate", () => {
    worksheet.value("B1");
  });

  let changedValue = 500;
  bench("invalidate one precedent and recalculate the aggregate", () => {
    changedValue += 1;
    worksheet.setInput("A250", String(changedValue));
    worksheet.value("B1");
  });
});

describe("formula compilation", () => {
  const expression = "=SUM(A1:A500)*2+ROUND(A250/3,2)";
  const program = compileFormula(expression);
  const bytecode = lowerFormula(program);
  const resolve = (address: string) => Number(address.slice(1));

  bench("parse and evaluate a 500-reference formula", () => {
    evaluateFormula(expression, resolve);
  });

  bench("evaluate a precompiled 500-reference formula", () => {
    evaluateCompiledFormula(program, resolve);
  });

  bench("evaluate lowered bytecode", () => {
    evaluateBytecode(bytecode, resolve);
  });
});

describe("dependency scheduler", () => {
  const graph = new Map<string, ReadonlySet<string>>();
  const dirty: string[] = [];
  for (let index = 0; index < 5_000; index++) {
    const address = `A${index + 1}`;
    dirty.push(address);
    graph.set(address, index === 0 ? new Set() : new Set([`A${index}`]));
  }

  bench("topologically plan a 5,000-formula dirty chain", () => {
    planRecalculation(dirty, graph);
  });
});

describe("range metadata", () => {
  bench("write and consolidate 1,000 adjacent formats", () => {
    const formats = new RangeStore<string>();
    for (let row = 0; row < 1_000; row++) {
      formats.write({ start: { row, column: 0 }, end: { row, column: 0 } }, "bold");
    }
  });
});

describe("million-row viewport planning", () => {
  const adapter = new HttpPagedDataAdapter("/api/table", async () => ({ ok: true, status: 200, json: async () => ({ records: [], revision: "r1", totalRows: 1_000_000 }) }));
  const loader = new ViewportPageLoader(adapter, new DataPageCache(24), {
    datasetId: "million", queryKey: "all", pageSize: 200, prefetchPages: 1,
  });
  bench("plan a viewport near row 900,000", () => {
    loader.requestsFor({ rowStart: 900_000, rowEnd: 900_060, fieldIds: ["id", "result", "status"] });
  });
});
