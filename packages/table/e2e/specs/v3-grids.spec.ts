/**
 * COMP-02.6 visual fixture (exit): the SheetWorking grid rendered from the
 * design's nine conditions under `themes/v3.css`, compared with a crop of
 * `SheetWorking-{light,dark}.png`.
 *
 * Crop box (SheetWorking renders, 1440×1000, scale 1): x=256 y=232 w=855 h=293
 * — the `.g` grid's border box: 25px row-number gutter + eight columns
 * (107/103/108/107/133/99/91/82) and a 40px two-tier header over nine 28px rows.
 *
 * The design renders are Chromium screenshots at deviceScaleFactor 1; the
 * comparison is meaningful only against the same engine, so this spec runs on
 * Chromium.
 */
import { expect, test } from "@playwright/test";
import { compareToCrop } from "../../../../e2e/visual-compare";

const cropUrl = (name: string) => new URL(`../../../../e2e/fixtures/v3/${name}`, import.meta.url).pathname;

test.skip(({ browserName }) => browserName !== "chromium", "design renders are Chromium screenshots");

for (const theme of ["light", "dark"] as const) {
  test(`SheetWorking grid matches the design crop (${theme})`, async ({ page }) => {
    await page.goto(`/v3.html?theme=${theme}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const grid = page.locator("#grid-fixture .spreadsheet");
    await expect(grid).toBeVisible();
    const result = await compareToCrop(page, grid, cropUrl(`sheetworking-grid-${theme}.png`), {
      diffPath: `test-results/v3/sheetworking-grid-${theme}.diff.png`,
    });
    console.log(`[v3-grids] ${theme}: ${result.differing}/${result.total} px differ (${(result.ratio * 100).toFixed(3)}%)`);
  });
}
