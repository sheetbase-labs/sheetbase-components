import { useMemo, useState } from "react";
import { Worksheet } from "../engine/workbook";
import type { Scalar } from "../engine/types";
import { FUNCTION_NAMES } from "../engine/functions";
import { displayValue } from "../grid/model";

export type DemoFixture = Readonly<Record<string, Scalar>>;

export type DemoEntry = Readonly<{
  fn: string;
  formula: string;
  cells: DemoFixture;
  /** Spill producers render their Z1:AD6 neighbourhood instead of one anchor. */
  spill?: boolean;
}>;

export type DemoSection = Readonly<{ title: string; entries: readonly DemoEntry[] }>;

const NUM: DemoFixture = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };

const TABLE: DemoFixture = {
  A1: "p24 ELISA", B1: 3, C1: 18.42, D1: "Complete", E1: true,
  A2: "BCA", B2: 2, C2: 1.72, D2: "Review", E2: false,
  A3: "p24 ELISA", B3: 1, C3: 21.09, D3: "Complete", E3: true,
};
const TEXT: DemoFixture = { T1: "p24 ELISA", T2: "SMP-2084", T3: "  padded   " };
const DATES: DemoFixture = { F1: "2026-08-31", F2: "2026-09-04" };
const HLOOKUP_GRID: DemoFixture = { H1: "a", I1: "b", H2: 1, I2: 2 };
const EMPTY: DemoFixture = {};

function entry(fn: string, formula: string, cells: DemoFixture, spill = false): DemoEntry {
  return { fn, formula, cells, spill };
}

export const DEMO_SECTIONS: readonly DemoSection[] = [
  {
    title: "Dynamic arrays",
    entries: [
      entry("SEQUENCE", "=SEQUENCE(3,3,1,1)", EMPTY, true),
      entry("UNIQUE", "=UNIQUE(A1:A3)", TABLE, true),
      entry("SORT", "=SORT(C1:C3)", TABLE, true),
      entry("SORTBY", "=SORTBY(A1:A3,C1:C3,-1)", TABLE, true),
      entry("TRANSPOSE", "=TRANSPOSE(A1:A3)", TABLE, true),
      entry("FILTER", "=FILTER(A1:A3,E1:E3)", TABLE, true),
    ],
  },
  {
    title: "Lookup",
    entries: [
      entry("XLOOKUP", '=XLOOKUP("BCA",A1:A3,C1:C3)', TABLE),
      entry("XLOOKUP", '=XLOOKUP("p24*",A1:A3,C1:C3,"none",2)', TABLE),
      entry("MATCH", '=MATCH("BCA",A1:A3,0)', TABLE),
      entry("VLOOKUP", '=VLOOKUP("BCA",A1:C3,3)', TABLE),
      entry("HLOOKUP", '=HLOOKUP("b",H1:I2,2)', HLOOKUP_GRID),
      entry("INDEX", "=INDEX(C1:C3,2)", TABLE),
      entry("CHOOSE", '=CHOOSE(2,"a","b","c")', EMPTY),
      entry("ROWS", "=ROWS(A1:C3)", TABLE),
      entry("COLUMNS", "=COLUMNS(A1:C3)", TABLE),
      entry("ADDRESS", "=ADDRESS(3,2)", EMPTY),
    ],
  },
  {
    title: "Math",
    entries: [
      entry("PI", "=PI()", EMPTY),
      entry("ABS", "=ABS(-3)", EMPTY),
      entry("SIGN", "=SIGN(-3)", EMPTY),
      entry("SQRT", "=SQRT(16)", EMPTY),
      entry("POWER", "=POWER(2,10)", EMPTY),
      entry("EXP", "=EXP(0)", EMPTY),
      entry("LN", "=LN(2.718281828459045)", EMPTY),
      entry("LOG", "=LOG(8,2)", EMPTY),
      entry("LOG10", "=LOG10(1000)", EMPTY),
      entry("MOD", "=MOD(7,3)", EMPTY),
      entry("INT", "=INT(-1.5)", EMPTY),
      entry("TRUNC", "=TRUNC(-1.9)", EMPTY),
      entry("ROUND", "=ROUND(2.5,0)", EMPTY),
      entry("ROUNDUP", "=ROUNDUP(1.21,1)", EMPTY),
      entry("ROUNDDOWN", "=ROUNDDOWN(1.29,1)", EMPTY),
      entry("MROUND", "=MROUND(7,5)", EMPTY),
      entry("CEILING", "=CEILING(7,5)", EMPTY),
      entry("CEILING.MATH", "=CEILING.MATH(-7,5)", EMPTY),
      entry("FLOOR", "=FLOOR(7,5)", EMPTY),
      entry("FLOOR.MATH", "=FLOOR.MATH(-7,5)", EMPTY),
      entry("SIN", "=SIN(0)", EMPTY),
      entry("COS", "=COS(0)", EMPTY),
      entry("TAN", "=TAN(0)", EMPTY),
      entry("ASIN", "=ASIN(1)", EMPTY),
      entry("ACOS", "=ACOS(1)", EMPTY),
      entry("ATAN", "=ATAN(1)", EMPTY),
      entry("ATAN2", "=ATAN2(1,1)", EMPTY),
      entry("DEGREES", "=DEGREES(PI())", EMPTY),
      entry("RADIANS", "=RADIANS(180)", EMPTY),
      entry("FACT", "=FACT(5)", EMPTY),
      entry("FACTDOUBLE", "=FACTDOUBLE(9)", EMPTY),
      entry("COMBIN", "=COMBIN(10,3)", EMPTY),
      entry("GCD", "=GCD(24,36)", EMPTY),
      entry("LCM", "=LCM(4,6)", EMPTY),
      entry("PRODUCT", "=PRODUCT(A1:A5)", NUM),
      entry("SUMSQ", "=SUMSQ(1,2,3)", EMPTY),
      entry("SUMPRODUCT", "=SUMPRODUCT(A1:A3,A1:A3)", NUM),
      entry("SUBTOTAL", "=SUBTOTAL(9,A1:A5)", NUM),
      entry("SERIESSUM", "=SERIESSUM(2,0,1,A1:A3)", NUM),
      entry("BASE", "=BASE(255,16)", EMPTY),
      entry("DECIMAL", '=DECIMAL("FF",16)', EMPTY),
      entry("ROMAN", "=ROMAN(2026)", EMPTY),
      entry("ARABIC", '=ARABIC("MMXXVI")', EMPTY),
    ],
  },
  {
    title: "Aggregates",
    entries: [
      entry("SUM", "=SUM(A1:A5)", NUM),
      entry("AVERAGE", "=AVERAGE(A1:A5)", NUM),
      entry("MIN", "=MIN(A1:A5)", NUM),
      entry("MAX", "=MAX(A1:A5)", NUM),
      entry("COUNT", "=COUNT(A1:A5)", NUM),
      entry("COUNTA", "=COUNTA(A1:A5)", NUM),
      entry("MEDIAN", "=MEDIAN(A1:A5)", NUM),
      entry("GEOMEAN", "=GEOMEAN(A1:A5)", NUM),
      entry("HARMEAN", "=HARMEAN(A1:A5)", NUM),
      entry("LARGE", "=LARGE(A1:A5,2)", NUM),
      entry("SMALL", "=SMALL(A1:A5,2)", NUM),
    ],
  },
  {
    title: "Statistics",
    entries: [
      entry("SKEW", "=SKEW(A1:A5)", NUM),
      entry("SKEW.P", "=SKEW.P(A1:A5)", NUM),
      entry("STDEV", "=STDEV(A1:A5)", NUM),
      entry("STDEV.S", "=STDEV.S(A1:A5)", NUM),
      entry("STDEVA", "=STDEVA(A1:A5)", NUM),
      entry("STDEV.P", "=STDEV.P(A1:A5)", NUM),
      entry("STDEVP", "=STDEVP(A1:A5)", NUM),
      entry("STDEVPA", "=STDEVPA(A1:A5)", NUM),
      entry("VAR", "=VAR(A1:A5)", NUM),
      entry("VAR.S", "=VAR.S(A1:A5)", NUM),
      entry("VARA", "=VARA(A1:A5)", NUM),
      entry("VAR.P", "=VAR.P(A1:A5)", NUM),
      entry("VARP", "=VARP(A1:A5)", NUM),
      entry("VARPA", "=VARPA(1,2,3)", EMPTY),
      entry("CORREL", "=CORREL(A1:A3,A1:A3)", NUM),
      entry("PEARSON", "=PEARSON(A1:A3,A1:A3)", NUM),
      entry("RSQ", "=RSQ(A1:A3,A1:A3)", NUM),
      entry("COVARIANCE.P", "=COVARIANCE.P(A1:A3,A1:A3)", NUM),
      entry("COVARIANCE.S", "=COVARIANCE.S(A1:A3,A1:A3)", NUM),
      entry("PERCENTILE", "=PERCENTILE(A1:A5,0.5)", NUM),
      entry("PERCENTILE.INC", "=PERCENTILE.INC(A1:A5,0.5)", NUM),
      entry("PERCENTILE.EXC", "=PERCENTILE.EXC(A1:A5,0.5)", NUM),
      entry("QUARTILE", "=QUARTILE(A1:A5,2)", NUM),
      entry("QUARTILE.INC", "=QUARTILE.INC(A1:A5,2)", NUM),
      entry("QUARTILE.EXC", "=QUARTILE.EXC(A1:A5,2)", NUM),
      entry("CONFIDENCE", "=CONFIDENCE(0.05,2,100)", EMPTY),
      entry("CONFIDENCE.NORM", "=CONFIDENCE.NORM(0.05,2,100)", EMPTY),
      entry("CONFIDENCE.T", "=CONFIDENCE.T(0.05,2,10)", EMPTY),
    ],
  },
  {
    title: "Distributions and tests",
    entries: [
      entry("NORM.S.DIST", "=NORM.S.DIST(0)", EMPTY),
      entry("NORM.S.INV", "=NORM.S.INV(0.975)", EMPTY),
      entry("NORM.DIST", "=NORM.DIST(0,0,1)", EMPTY),
      entry("NORM.INV", "=NORM.INV(0.975,0,1)", EMPTY),
      entry("CHISQ.DIST", "=CHISQ.DIST(1,1)", EMPTY),
      entry("CHISQ.INV", "=CHISQ.INV(0.95,1)", EMPTY),
      entry("CHISQ.TEST", "=CHISQ.TEST(G1:G2,H1:H2)", { G1: 10, G2: 20, H1: 12, H2: 18 }),
      entry("F.DIST", "=F.DIST(1,5,10)", EMPTY),
      entry("F.INV", "=F.INV(0.95,5,10)", EMPTY),
      entry("F.TEST", "=F.TEST(A1:A5,B1:B5)", { ...NUM, B1: 2, B2: 4, B3: 6, B4: 8, B5: 10 }),
      entry("T.DIST", "=T.DIST(1,10)", EMPTY),
      entry("T.DIST.2T", "=T.DIST.2T(1,10)", EMPTY),
      entry("T.INV", "=T.INV(0.95,10)", EMPTY),
      entry("T.INV.2T", "=T.INV.2T(0.05,10)", EMPTY),
      entry("T.TEST", "=T.TEST(A1:A5,B1:B5,2,2)", { ...NUM, B1: 2, B2: 4, B3: 6, B4: 8, B5: 10 }),
    ],
  },
  {
    title: "Criteria aggregation",
    entries: [
      entry("SUMIF", '=SUMIF(A1:A3,"p24 ELISA",C1:C3)', TABLE),
      entry("AVERAGEIF", '=AVERAGEIF(A1:A3,"p24 ELISA",C1:C3)', TABLE),
      entry("COUNTIF", '=COUNTIF(D1:D3,"Complete")', TABLE),
      entry("SUMIFS", '=SUMIFS(C1:C3,A1:A3,"p24 ELISA",D1:D3,"Complete")', TABLE),
      entry("AVERAGEIFS", '=AVERAGEIFS(C1:C3,A1:A3,"p24 ELISA")', TABLE),
      entry("COUNTIFS", '=COUNTIFS(A1:A3,"p24 ELISA",D1:D3,"Complete")', TABLE),
    ],
  },
  {
    title: "Text",
    entries: [
      entry("LEN", "=LEN(T1)", TEXT),
      entry("LEFT", "=LEFT(T1,3)", TEXT),
      entry("RIGHT", "=RIGHT(T1,5)", TEXT),
      entry("MID", "=MID(T1,5,5)", TEXT),
      entry("UPPER", "=UPPER(T1)", TEXT),
      entry("LOWER", "=LOWER(T1)", TEXT),
      entry("PROPER", '=PROPER("p24 elisa")', EMPTY),
      entry("TRIM", '=TRIM("  a  b  ")', EMPTY),
      entry("CLEAN", '=CLEAN("a\u0001b")', EMPTY),
      entry("REPT", '=REPT("ha",3)', EMPTY),
      entry("CONCATENATE", '=CONCATENATE(T1,"-",T2)', TEXT),
      entry("TEXTJOIN", '=TEXTJOIN(", ",TRUE,T1,T2)', TEXT),
      entry("VALUE", '=VALUE("12.5")', EMPTY),
      entry("TEXT", '=TEXT(0.956,"0.0%")', EMPTY),
      entry("FIND", '=FIND("ELISA",T1)', TEXT),
      entry("SEARCH", '=SEARCH("elisa",T1)', TEXT),
      entry("REPLACE", '=REPLACE(T1,5,5,"ID")', TEXT),
      entry("SUBSTITUTE", '=SUBSTITUTE(T1,"ELISA","ID")', TEXT),
    ],
  },
  {
    title: "Dates and time",
    entries: [
      entry("DATE", "=DATE(2026,9,4)", EMPTY),
      entry("YEAR", "=YEAR(F1)", DATES),
      entry("MONTH", "=MONTH(F1)", DATES),
      entry("DAY", "=DAY(F1)", DATES),
      entry("TIME", "=TIME(13,30,0)", EMPTY),
      entry("HOUR", "=HOUR(TIME(13,30,0))", EMPTY),
      entry("MINUTE", "=MINUTE(TIME(13,30,0))", EMPTY),
      entry("SECOND", "=SECOND(TIME(13,30,45))", EMPTY),
      entry("DATEVALUE", '=DATEVALUE("2026-09-04")', EMPTY),
      entry("TIMEVALUE", '=TIMEVALUE("1970-01-01T13:30:00Z")', EMPTY),
      entry("WEEKDAY", '=WEEKDAY("2026-09-04")', EMPTY),
      entry("WEEKNUM", '=WEEKNUM("2026-09-04")', EMPTY),
      entry("ISOWEEKNUM", '=ISOWEEKNUM("2026-09-04")', EMPTY),
      entry("EDATE", "=EDATE(F1,1)", DATES),
      entry("EOMONTH", "=EOMONTH(F1,0)", DATES),
      entry("DATEDIF", '=DATEDIF(F1,F2,"D")', DATES),
      entry("NETWORKDAYS", "=NETWORKDAYS(F1,F2)", DATES),
      entry("WORKDAY", "=WORKDAY(F2,1)", DATES),
    ],
  },
  {
    title: "Logic and errors",
    entries: [
      entry("IF", '=IF(1>2,"yes","no")', EMPTY),
      entry("AND", "=AND(1>0,2>1)", EMPTY),
      entry("OR", "=OR(1>2,2>1)", EMPTY),
      entry("NOT", "=NOT(1>2)", EMPTY),
      entry("IFERROR", '=IFERROR(1/0,"safe")', EMPTY),
      entry("ISERROR", "=ISERROR(1/0)", EMPTY),
      entry("IFNA", '=IFNA(1,"x")', EMPTY),
      entry("IFS", '=IFS(1>2,"a",2>1,"b")', EMPTY),
      entry("XOR", "=XOR(TRUE,FALSE)", EMPTY),
      entry("SWITCH", '=SWITCH("b","a",1,"b",2,99)', EMPTY),
      entry("N", "=N(5)", EMPTY),
      entry("NA", "=NA()", EMPTY),
      entry("ISBLANK", "=ISBLANK(Z9)", EMPTY),
      entry("ISNA", "=ISNA(NA())", EMPTY),
      entry("ISNUMBER", "=ISNUMBER(A1)", NUM),
      entry("ISTEXT", "=ISTEXT(T1)", TEXT),
      entry("ISNONTEXT", "=ISNONTEXT(A1)", NUM),
      entry("ISLOGICAL", "=ISLOGICAL(TRUE)", EMPTY),
      entry("ISODD", "=ISODD(3)", EMPTY),
      entry("ISEVEN", "=ISEVEN(4)", EMPTY),
      entry("ISREF", "=ISREF(A1)", NUM),
    ],
  },
  {
    title: "Volatile",
    entries: [
      entry("TODAY", "=TODAY()", EMPTY),
      entry("NOW", "=NOW()", EMPTY),
      entry("RAND", "=RAND()", EMPTY),
      entry("RANDBETWEEN", "=RANDBETWEEN(1,100)", EMPTY),
    ],
  },
];

export const FUNCTION_DEMO_ENTRIES: readonly DemoEntry[] = DEMO_SECTIONS.flatMap((section) => section.entries);

export function evaluateDemoEntry(entry: DemoEntry): string {
  const sheet = new Worksheet();
  for (const [address, value] of Object.entries(entry.cells)) sheet.set(address, value);
  sheet.setInput("Z1", entry.formula);
  if (!entry.spill) return displayValue(sheet, { row: 0, column: 25 });
  const rows: string[] = [];
  for (let row = 0; row < 6; row++) {
    const cells: string[] = [];
    for (let column = 25; column < 30; column++) {
      const text = displayValue(sheet, { row, column });
      if (text !== "") cells.push(text);
    }
    if (cells.length === 0) break;
    rows.push(cells.join(", "));
  }
  return rows.length === 0 ? "#EMPTY!" : rows.join("  /  ");
}
export function FunctionsDemo({ theme = "light" }: Readonly<{ theme?: "light" | "dark" }> = {}) {
  const [filter, setFilter] = useState("");
  const results = useMemo(() => {
    const computed = new Map<string, string>();
    for (const entry of FUNCTION_DEMO_ENTRIES) {
      computed.set(`${entry.fn} ${entry.formula}`, evaluateDemoEntry(entry));
    }
    return computed;
  }, []);
  const query = filter.trim().toUpperCase();
  const visibleSections = useMemo(() => {
    const visible: DemoSection[] = [];
    for (const section of DEMO_SECTIONS) {
      const entries = section.entries.filter((entry) => entry.fn.includes(query));
      if (entries.length > 0) visible.push({ ...section, entries });
    }
    return visible;
  }, [query]);
  const covered = new Set(FUNCTION_DEMO_ENTRIES.map((entry) => entry.fn));
  const total = FUNCTION_NAMES.length;
  const shown = FUNCTION_NAMES.filter((name) => covered.has(name)).length;
  return (
    <section className="functions-demo" data-theme={theme} aria-label="Supported functions">
      <header className="functions-demo-head">
        <div>
          <h2>Supported functions</h2>
          <p>
            Every result below is evaluated live by the engine at render time — nothing is hardcoded.{" "}
            <strong>{shown}/{total} registry functions shown</strong>.
          </p>
        </div>
        <input
          aria-label="Filter functions"
          placeholder="Filter, e.g. LOOKUP"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </header>
      {visibleSections.map((section) => (
        <div key={section.title}>
          <h3>{section.title}</h3>
          <table>
            <thead>
              <tr><th>Function</th><th>Example</th><th>Result</th></tr>
            </thead>
            <tbody>
              {section.entries.map((entry) => (
                <tr key={`${entry.fn} ${entry.formula}`}>
                  <td><code>{entry.fn}</code></td>
                  <td><code>{entry.formula}</code></td>
                  <td><code>{results.get(`${entry.fn} ${entry.formula}`)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
