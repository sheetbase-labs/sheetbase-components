import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SheetbaseField } from "./fields";
import { emptyView } from "./analysis";
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
