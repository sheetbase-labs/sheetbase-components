import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SheetbaseField } from "./fields";
import { emptyView, pruneViewToFields, type AnalysisView } from "./analysis";
import { createMemoryAdapter } from "./persistence";
import type { FilterNode, GroupNode } from "./tree";
import {
  useWorkbench,
  useWorkspaceSource,
  WorkspaceProvider,
  type WorkbenchGlue,
} from "./workspace";

const fields: SheetbaseField[] = [
  { id: "status", label: "status", dataType: "text" },
  { id: "amount", label: "amount", dataType: "number" },
];

const rows = [
  { status: "ok", amount: 10 },
  { status: "failed", amount: 20 },
  { status: "ok", amount: 30 },
];

const source = {
  fetchPage: () => Promise.resolve({ records: [], totalRows: 0 }),
};

function Probe({ options, report }: { options: Parameters<typeof useWorkbench>[0]; report: (glue: WorkbenchGlue) => void }) {
  report(useWorkbench(options));
  return null;
}

function glue(options: Parameters<typeof useWorkbench>[0]): WorkbenchGlue {
  let captured: WorkbenchGlue | undefined;
  renderToStaticMarkup(<Probe options={options} report={(glue) => (captured = glue)} />);
  if (!captured) throw new Error("probe did not capture glue");
  return captured;
}

describe("useWorkbench", () => {
  it("derives view rows from materialised rows", () => {
    const wb = glue({ fields, rows, initialView: emptyView() });
    expect(wb.remote).toBe(false);
    expect(wb.viewRows).toHaveLength(3);
    expect(wb.workspace.rows).toBe(rows);
    expect(wb.workspace.source).toBeUndefined();
  });

  it("runs server-backed: null slices, source in workspace", () => {
    const wb = glue({ fields, source, initialView: emptyView() });
    expect(wb.remote).toBe(true);
    expect(wb.viewRows).toBeNull();
    expect(wb.filteredRows).toBeNull();
    expect(wb.workspace.source).toBe(source);
    expect(wb.workspace.rows).toBeUndefined();
  });

  it("rejects passing both rows and source, or neither", () => {
    expect(() => glue({ fields, rows, source, initialView: emptyView() })).toThrow(TypeError);
    expect(() => glue({ fields, initialView: emptyView() })).toThrow(TypeError);
  });

  it("merges a persisted view over the initial one", () => {
    const adapter = createMemoryAdapter<AnalysisView>();
    adapter.save("search", { ...emptyView("sum"), limit: 1 });
    const wb = glue({ fields, rows, initialView: emptyView("mean"), persistKey: "search", adapter });
    expect(wb.view.summary).toBe("sum");
    expect(wb.view.limit).toBe(1);
    // The persisted limit applies to view rows but not the filtered counter.
    expect(wb.viewRows).toHaveLength(1);
    expect(wb.filteredRows).toHaveLength(3);
  });

  it("prunes persisted references to fields the dataset lacks", () => {
    const adapter = createMemoryAdapter<AnalysisView>();
    adapter.save("search", {
      ...emptyView("sum"),
      filter: {
        type: "group",
        id: "g",
        combinator: "AND",
        children: [
          { type: "condition", id: "c1", field: "status", operator: "eq", value: "ok" },
          { type: "condition", id: "c2", field: "material", operator: "eq", value: "steel" },
          {
            type: "group",
            id: "g2",
            combinator: "OR",
            children: [{ type: "condition", id: "c3", field: "batch", operator: "eq", value: "B1" }],
          },
        ],
      },
      groupBy: "material",
      sort: { field: "material", direction: "asc" },
    });
    const wb = glue({ fields, rows, initialView: emptyView(), persistKey: "search", adapter });
    // 'material'/'batch' conditions and the emptied OR group are gone; 'status' survives.
    expect(wb.view.filter.children).toHaveLength(1);
    expect(wb.view.filter.children[0]).toMatchObject({ field: "status" });
    expect(wb.filteredRows).toHaveLength(2);
    expect(wb.view.groupBy).toBeUndefined();
    expect(wb.view.sort).toBeUndefined();
  });
});

describe("pruneViewToFields", () => {
  const cond = (id: string, field: string): FilterNode => ({ type: "condition", id, field, operator: "eq", value: "x" });
  const group = (id: string, children: FilterNode[]): GroupNode => ({ type: "group", id, combinator: "AND", children });

  it("returns the same object when nothing is stale", () => {
    const view: AnalysisView = {
      ...emptyView("mean"),
      filter: group("g", [cond("a", "status"), cond("b", "amount")]),
      groupBy: "status",
      sort: { field: "amount", direction: "desc" },
      limit: 5,
    };
    expect(pruneViewToFields(view, fields)).toBe(view);
  });

  it("prunes unknown conditions and collapses emptied child groups", () => {
    const view: AnalysisView = {
      ...emptyView(),
      filter: group("g", [
        cond("a", "status"),
        cond("b", "material"),
        group("inner", [cond("c", "batch")]),
      ]),
    };
    const next = pruneViewToFields(view, fields);
    expect(next.filter.children).toHaveLength(1);
    expect(next.filter.children[0]).toMatchObject({ field: "status" });
  });

  it("drops unknown groupBy and sort fields", () => {
    const view: AnalysisView = {
      ...emptyView(),
      groupBy: "material",
      sort: { field: "material", direction: "asc" },
    };
    const next = pruneViewToFields(view, fields);
    expect(next.groupBy).toBeUndefined();
    expect(next.sort).toBeUndefined();
  });
});

describe("useWorkspaceSource", () => {
  function SourceProbe({ report }: { report: (source: unknown) => void }) {
    report(useWorkspaceSource());
    return null;
  }

  it("returns the source under a remote provider", () => {
    let seen: unknown;
    renderToStaticMarkup(
      <WorkspaceProvider value={{ fields, query: {}, source }}>
        <SourceProbe report={(s) => (seen = s)} />
      </WorkspaceProvider>,
    );
    expect(seen).toBe(source);
  });

  it("returns null outside a provider", () => {
    let seen: unknown = "unset";
    renderToStaticMarkup(<SourceProbe report={(s) => (seen = s)} />);
    expect(seen).toBeNull();
  });
});
