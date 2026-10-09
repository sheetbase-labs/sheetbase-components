import { describe, expect, it } from "vitest";
import { composeFormulaNormalizer } from "./formula-engine";

describe("composeFormulaNormalizer", () => {
  it("substitutes structured tokens when no host normalizer is given", () => {
    const normalize = composeFormulaNormalizer((fieldId) => (fieldId === "total" ? "B1:B9" : undefined));
    expect(normalize("=SUM([total])")).toBe("=SUM(B1:B9)");
  });

  it("leaves unknown tokens untouched", () => {
    const normalize = composeFormulaNormalizer(() => undefined);
    expect(normalize("=[missing]+1")).toBe("=[missing]+1");
  });

  it("passes the substituted text to the host normalizer", () => {
    const seen: string[] = [];
    const normalize = composeFormulaNormalizer(
      (fieldId) => (fieldId === "total" ? "B1:B9" : undefined),
      (expression) => {
        seen.push(expression);
        return expression.replace("SUM", "TOTAL");
      },
    );
    expect(normalize("=SUM([total])")).toBe("=TOTAL(B1:B9)");
    expect(seen).toEqual(["=SUM(B1:B9)"]);
  });
});
