import { describe, expect, it } from "vitest";
import { formulaTokenParts } from "./FormulaTokens";

describe("formulaTokenParts", () => {
  it("uses stable colours for repeated cell and structured references", () => {
    const parts = formulaTokenParts("=SUM(A1:A8)+[result]+A1:A8");
    expect(parts.filter((part) => part.colour).map((part) => [part.text, part.colour])).toEqual([
      ["A1:A8", "reference-green"],
      ["[result]", "reference-orange"],
      ["A1:A8", "reference-green"],
    ]);
  });

  it("colours qualified cross-sheet references", () => {
    expect(formulaTokenParts("='Raw Data'!B2+Inputs!A1").filter((part) => part.colour)).toHaveLength(2);
  });
});
