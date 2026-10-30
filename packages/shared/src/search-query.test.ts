import { describe, expect, it } from "vitest";
import type { SheetbaseField } from "./fields";
import { formatSearchQuery, isQueryExpressible, parseSearchQuery } from "./search-query";
import { canonicalFilterTree, emptyGroup } from "./tree";

const FIELDS: SheetbaseField[] = [
  { id: "status", label: "Status", dataType: "text", options: ["Approved", "In review"] },
  { id: "title", label: "Title", dataType: "text" },
  { id: "osmolality", label: "Osmolality", dataType: "number" },
  { id: "created", label: "Created on", dataType: "date" },
  { id: "gmp", label: "GMP", dataType: "boolean" },
];

const filterOf = (input: string) => canonicalFilterTree(parseSearchQuery(input, FIELDS).filter);
const cond = (field: string, operator: string, value: unknown) => ({ type: "condition", field, operator, value });
const and = (...children: unknown[]) => ({ type: "group", combinator: "AND", children });

describe("parseSearchQuery", () => {
  it("leaves plain text alone", () => {
    const out = parseSearchQuery('chrom "buffer prep" -tris a OR b', FIELDS);
    expect(out.text).toBe('chrom "buffer prep" -tris a OR b');
    expect(out.filter.children).toHaveLength(0);
  });

  it("reads field tokens, matching id or label in any case", () => {
    expect(filterOf("status:approved")).toEqual(and(cond("status", "eq", "approved")));
    expect(filterOf("STATUS:approved")).toEqual(and(cond("status", "eq", "approved")));
    expect(filterOf("created_on:2026-01-01")).toEqual(and(cond("created", "eq", "2026-01-01")));
    expect(filterOf("title:buffer")).toEqual(and(cond("title", "contains", "buffer")));
    expect(filterOf("title:=buffer")).toEqual(and(cond("title", "eq", "buffer")));
  });

  it("reads quoted values, lists, comparisons and ranges", () => {
    expect(filterOf('status:"in review"')).toEqual(and(cond("status", "eq", "in review")));
    expect(filterOf('status:approved,"in review"')).toEqual(and(cond("status", "in", ["approved", "in review"])));
    expect(filterOf("osmolality:>5")).toEqual(and(cond("osmolality", "gt", 5)));
    expect(filterOf("osmolality:<=2.5")).toEqual(and(cond("osmolality", "lte", 2.5)));
    expect(filterOf("created:<2026-10-01")).toEqual(and(cond("created", "lt", "2026-10-01")));
    expect(filterOf("osmolality:280..320")).toEqual(and(cond("osmolality", "between", [280, 320])));
    expect(filterOf("gmp:yes")).toEqual(and(cond("gmp", "eq", true)));
  });

  it("negates with a leading minus", () => {
    expect(filterOf("-status:approved")).toEqual(
      and({ type: "group", combinator: "NOT", children: [cond("status", "eq", "approved")] }),
    );
  });

  it("keeps unknown keys and unusable values as text", () => {
    const out = parseSearchQuery("colour:red osmolality:high status: -nope:1", FIELDS);
    expect(out.text).toBe("colour:red osmolality:high status: -nope:1");
    expect(out.filter.children).toHaveLength(0);
  });

  it("mixes text and tokens", () => {
    const out = parseSearchQuery('buffer status:approved "tris base" -title:old', FIELDS);
    expect(out.text).toBe('buffer "tris base"');
    expect(out.filter.children).toHaveLength(2);
  });
});

describe("formatSearchQuery", () => {
  const roundTrips = [
    "buffer",
    '"two words" -tris OR b',
    "status:=approved",
    "-status:approved",
    'status:approved,"in review"',
    "osmolality:>5",
    "osmolality:>=5 osmolality:<10",
    "osmolality:280..320",
    "created:<2026-10-01",
    "title:buffer",
    "title:=buffer",
    'title:"two words"',
    "gmp:true",
    'chrom status:=approved -title:"old one" osmolality:>5',
  ];
  for (const input of roundTrips) {
    it(`round-trips ${input}`, () => {
      const parsed = parseSearchQuery(input, FIELDS);
      const again = parseSearchQuery(formatSearchQuery(parsed, FIELDS), FIELDS);
      expect(again.text).toBe(parsed.text);
      expect(canonicalFilterTree(again.filter)).toEqual(canonicalFilterTree(parsed.filter));
    });
  }

  it("quotes values that need it", () => {
    const filter = { ...emptyGroup(), children: [{ type: "condition" as const, id: "c", field: "title", operator: "eq" as const, value: "a, b" }] };
    expect(formatSearchQuery({ text: "", filter }, FIELDS)).toBe('title:="a, b"');
  });

  it("skips what the box cannot say", () => {
    const filter = {
      ...emptyGroup(),
      children: [
        { type: "group" as const, id: "g", combinator: "OR" as const, children: [] },
        { type: "condition" as const, id: "c", field: "title", operator: "isNull" as const },
      ],
    };
    expect(formatSearchQuery({ text: "x", filter }, FIELDS)).toBe("x");
    expect(isQueryExpressible(filter, FIELDS)).toBe(false);
    expect(isQueryExpressible(parseSearchQuery("status:a title:b", FIELDS).filter, FIELDS)).toBe(true);
  });
});
