/**
 * COMP-03 visual fixture (exit): the Notebook Figure 1 step-yield chart rendered
 * from the design fixture under `themes/v3.css`, compared with a crop of
 * `Notebook-{light,dark}.png`.
 *
 * Crop box (Notebook renders, 1440×1840, scale 1): x=264 y=1134 w=844 h=262 —
 * the chart SVG's own box. Plot 56,20 → 824,220; the figure title and legend sit
 * above it and are not part of the `Chart` figure.
 */
import { expect, test } from "@playwright/test";
import { compareToCrop } from "../../../e2e/visual-compare";

const cropUrl = (name: string) => new URL(`../../../e2e/fixtures/v3/${name}`, import.meta.url).pathname;

for (const theme of ["light", "dark"] as const) {
  test(`step-yield chart matches the Notebook Figure 1 crop (${theme})`, async ({ page }) => {
    await page.goto(`/v3.html?theme=${theme}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const svg = page.locator(".sb-figure").first();
    await expect(svg).toBeVisible();
    const result = await compareToCrop(page, svg, cropUrl(`notebook-step-yield-${theme}.png`), {
      diffPath: `test-results/v3/step-yield-${theme}.diff.png`,
    });
    console.log(`[v3-chart] ${theme}: ${result.differing}/${result.total} px differ (${(result.ratio * 100).toFixed(3)}%)`);
  });
}
