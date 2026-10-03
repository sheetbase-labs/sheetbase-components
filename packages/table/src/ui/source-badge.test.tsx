import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CALC_SOURCE_LABEL, SourceBadge, showsComputedMark, sourceBadgeLabel } from "./source-badge";

describe("sourceBadgeLabel", () => {
  it("uses the host label when present", () => {
    expect(sourceBadgeLabel("dataset", "DS-0311 · S-15")).toBe("DS-0311 · S-15");
    expect(sourceBadgeLabel("record", "  S-15  ")).toBe("S-15");
  });

  it("reads ƒx for calculated columns and nothing for the rest", () => {
    expect(sourceBadgeLabel("calc")).toBe("ƒx");
    expect(sourceBadgeLabel("dataset")).toBeUndefined();
    expect(sourceBadgeLabel("record")).toBeUndefined();
    expect(sourceBadgeLabel("local")).toBeUndefined();
    expect(sourceBadgeLabel(undefined, "  ")).toBeUndefined();
  });
});

describe("showsComputedMark", () => {
  it("marks computed columns that carry no ƒx source badge", () => {
    expect(showsComputedMark(true, undefined)).toBe(true);
    expect(showsComputedMark(true, "dataset", "DS-0311 · S-15")).toBe(true);
    expect(showsComputedMark(false, undefined)).toBe(false);
  });

  it("does not duplicate the ƒx already shown by a calc source", () => {
    expect(showsComputedMark(true, "calc")).toBe(false);
    expect(showsComputedMark(true, "calc", "custom label")).toBe(true);
  });
});

describe("SourceBadge", () => {
  it("renders the kind class, an icon, and the label", () => {
    const html = renderToStaticMarkup(<SourceBadge source="dataset" label="DS-0311 · S-15" />);
    expect(html).toContain('class="src dataset"');
    expect(html).toContain("<svg");
    expect(html).toContain("DS-0311 · S-15");
  });

  it("marks local sources and labels calc sources ƒx", () => {
    expect(renderToStaticMarkup(<SourceBadge source="local" />)).toContain('class="src local"');
    const calc = renderToStaticMarkup(<SourceBadge source="calc" />);
    expect(calc).toContain('class="src calc"');
    expect(calc).toContain(CALC_SOURCE_LABEL);
  });
});
