/**
 * COMP-03 visual fixture (exit): the design's step-yield and turbidity figures
 * rendered from the design fixture under `themes/v3.css`, compared with crops
 * of the ELN design renders.
 *
 * Crop boxes (design renders, scale 1), both the SVG's own display box:
 * - step-yield (Notebook renders, 1440×1840): x=264 y=1141 w=844 h=262. The
 *   Notebook canvas draws Figure 1 at its natural 844×262 size.
 * - turbidity (Analysis renders, 1440×1000): x=482 y=384 w=640 h=149. The
 *   Analysis canvas authors chart 2 in an 844×196 viewBox (`plot 56,20 → 824,160`)
 *   but displays it in a 640×149 box, so the browser scales the viewBox by
 *   640/844 = 0.758 — as does the fixture (src/v3-fixture.tsx, CSS-sized to the
 *   same box; verified: axis/plot land on the same rows and columns).
 *
 * Font: the canvases ask for `Inter, sans-serif` and the design-reference
 * renderer answers that request from `@fontsource-variable/inter`, so both the
 * baseline and these fixtures rasterise the same Inter files (the fixture pins
 * the fontsource family name `Inter Variable`).
 *
 * Turbidity metrics: the Analysis canvas sizes text/markers/strokes for the
 * 0.758 display scale (text 15/14 viewBox units, markers r5, series stroke 1.8)
 * rather than the canonical figure metrics (11, r4, 1.6), so the fixture passes
 * the matching `spec.metrics` overlay and the figure reproduces the crop.
 */
import { expect, test } from "@playwright/test";
import { compareToCrop } from "../../../e2e/visual-compare";

const cropUrl = (name: string) => new URL(`../../../e2e/fixtures/v3/${name}`, import.meta.url).pathname;

const charts = [
  { name: "step-yield", chart: "step-yield", fixture: "notebook-step-yield" },
  { name: "turbidity", chart: "turbidity", fixture: "analysis-turbidity" },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const { name, chart, fixture } of charts) {
    test(`${name} chart matches the design crop (${theme})`, async ({ page }) => {
      await page.goto(`/v3.html?theme=${theme}&chart=${chart}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const svg = page.locator(".sb-figure").first();
      await expect(svg).toBeVisible();
      try {
        const result = await compareToCrop(page, svg, cropUrl(`${fixture}-${theme}.png`), {
          diffPath: `test-results/v3/${name}-${theme}.diff.png`,
        });
        console.log(
          `[v3-chart] ${name} ${theme}: ${result.differing}/${result.total} px differ (${(result.ratio * 100).toFixed(3)}%)`,
        );
      } catch (error) {
        // Keep the measured delta visible in the report.
        console.log(`[v3-chart] ${name} ${theme}: ${(error as Error).message}`);
        throw error;
      }
    });
  }
}
