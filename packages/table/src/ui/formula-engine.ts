import type { FormulaNormalizer, ReferenceResolver } from "../engine/workbook";

/**
 * Host-injectable seams for the grid's own formula engine.
 *
 * The package owns calculation (ADR-0048 option (b)): it compiles and evaluates
 * `"=…"` inputs itself, so an external engine instance cannot be handed in.
 * `calculationAuthority: "host"` remains the supported "the host owns
 * calculation" mode — formulas are kept as inert text and computed values
 * arrive through hydration.
 *
 * These seams configure the engine that does run:
 * - `referenceResolver` resolves qualified cross-sheet references
 *   (`Sheet1!A1`) to a scalar;
 * - `formulaNormalizer` rewrites formula text before compilation, after the
 *   built-in structured-reference substitution (`[fieldId]` → range).
 *
 * Both are read at mount, like `initialData`; remount to change the normalizer.
 */
export type SpreadsheetFormulaEngine = Readonly<{
  referenceResolver?: ReferenceResolver;
  formulaNormalizer?: FormulaNormalizer;
}>;

/**
 * Compose the grid's structured-reference substitution with a host normalizer.
 *
 * The built-in pass replaces every `[fieldId]` token through
 * `substituteStructured` (returning `undefined` leaves the token untouched);
 * the host normalizer then receives that text, so it sees A1 ranges rather
 * than structured tokens.
 */
export function composeFormulaNormalizer(
  substituteStructured: (fieldId: string) => string | undefined,
  hostNormalizer?: FormulaNormalizer,
): FormulaNormalizer {
  return (expression) => {
    const structured = expression.replace(
      /\[([^\]]+)\]/g,
      (token, fieldId: string) => substituteStructured(fieldId) ?? token,
    );
    return hostNormalizer ? hostNormalizer(structured) : structured;
  };
}
