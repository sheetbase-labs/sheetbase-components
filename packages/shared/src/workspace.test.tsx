import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyView } from "./analysis";
import { createMemoryAdapter } from "./persistence";
import { useWorkbench, type UseWorkbenchOptions, type WorkbenchGlue } from "./workspace";

const fields = [{ id: "status", label: "Status", dataType: "text" as const }];
const rows = [
  { status: "open", n: 1 },
  { status: "done", n: 2 },
  { status: "open", n: 3 },
];

function probe(options: UseWorkbenchOptions): WorkbenchGlue {
  let glue!: WorkbenchGlue;
  function Probe() {
    glue = useWorkbench(options);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return glue;
}

describe("useWorkbench", () => {
  it("starts from the initial view and exposes derived row slices", () => {
    const wb = probe({ fields, rows, initialView: emptyView("mean") });
    expect(wb.view.summary).toBe("mean");
    expect(wb.view.filter.combinator).toBe("AND");
    expect(wb.viewRows).toHaveLength(3);
    expect(wb.filteredRows).toHaveLength(3);
    expect(wb.query).toEqual({});
    expect(wb.workspace).toEqual({ fields, rows, query: {} });
  });

  it("loads a persisted view merged over the initial one", () => {
    const adapter = createMemoryAdapter<ReturnType<typeof emptyView>>();
    adapter.save("search", { ...emptyView("sum"), limit: 1 });
    const wb = probe({ fields, rows, initialView: emptyView("mean"), persistKey: "search", adapter });
    expect(wb.view.summary).toBe("sum");
    expect(wb.viewRows).toHaveLength(1);
    expect(wb.filteredRows).toHaveLength(3);
  });
});
