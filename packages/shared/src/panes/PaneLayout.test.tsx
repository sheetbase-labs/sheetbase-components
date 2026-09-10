import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Layout } from "./layout";
import { PaneLayout, type PaneSpec } from "./PaneLayout";
import { SheetbaseShell } from "./SheetbaseShell";

const panes: PaneSpec[] = [
  { id: "a", title: "Alpha", content: <div>alpha</div> },
  { id: "b", title: "Beta", content: <div>beta</div> },
];

const twoUp: Layout = {
  kind: "split",
  id: "root",
  direction: "row",
  sizes: [0.5, 0.5],
  children: [
    { kind: "stack", id: "left", panes: ["a"], active: "a" },
    { kind: "stack", id: "right", panes: ["b"], active: "b" },
  ],
};

describe("PaneLayout", () => {
  it("renders one tabbed stack by default and keeps every pane mounted", () => {
    const html = renderToStaticMarkup(<PaneLayout panes={panes} />);
    expect(html).toContain("sb-pane-stack");
    expect(html).not.toContain("sb-split");
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('data-pane-id="a"');
    expect(html).toContain('data-pane-id="b"');
    // Inactive tab is mounted but hidden.
    expect(html).toMatch(/hidden=""[^>]*data-pane-id="b"/);
  });

  it("renders splits with a resizer separator", () => {
    const html = renderToStaticMarkup(<PaneLayout panes={panes} layout={twoUp} />);
    expect(html).toContain("sb-split is-row");
    expect(html.match(/class="sb-pane-stack"/g)).toHaveLength(2);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
  });

  it("flags the active pane for assistive tech", () => {
    const html = renderToStaticMarkup(
      <PaneLayout
        panes={panes}
        layout={{ kind: "stack", id: "s", panes: ["a", "b"], active: "b" }}
      />,
    );
    expect(html).toMatch(/aria-selected="false"[^>]*>Alpha/);
    expect(html).toMatch(/aria-selected="true"[^>]*>Beta/);
  });

  it("establishes a theme scope when given a theme", () => {
    const html = renderToStaticMarkup(<PaneLayout panes={panes} theme="dark" />);
    expect(html).toContain("sheetbase-scope");
    expect(html).toContain('data-theme="dark"');
  });
});

describe("SheetbaseShell", () => {
  it("renders the shared frame, toolbar and theme toggle", () => {
    const html = renderToStaticMarkup(
      <SheetbaseShell theme="light" toolbar={<span>Toolbar</span>} onToggleTheme={() => {}}>
        <div>body</div>
      </SheetbaseShell>,
    );
    expect(html).toContain("sb-frame sb-shell-frame");
    expect(html).toContain("sb-topbar");
    expect(html).toContain("Toolbar");
    expect(html).toContain("body");
  });

  it("marks the frame when a subbar is present", () => {
    const html = renderToStaticMarkup(
      <SheetbaseShell theme="dark" subbar={<span>filters</span>}>
        <div>body</div>
      </SheetbaseShell>,
    );
    expect(html).toContain("has-subbar");
    expect(html).toContain("sb-subbar");
  });

  it("renders flat when frame is disabled", () => {
    const html = renderToStaticMarkup(
      <SheetbaseShell theme="light" frame={false}>
        <div>body</div>
      </SheetbaseShell>,
    );
    expect(html).toContain("sb-shell-flat");
    expect(html).not.toContain("sb-frame");
  });
});
