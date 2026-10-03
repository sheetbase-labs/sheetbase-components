/**
 * COMP-04.3 visual fixture (exit): the v3 `FilterBuilder` popover rendered from
 * the States screen's two conditions under `themes/v3.css`, compared with a crop
 * of `States-{light,dark}.png`.
 *
 * Crop box (States renders, 1440×1390, scale 1): x=557 y=1087 w=360 h=126 — the
 * `.popover` border box. The canvas declares `padding: 12px`; the render's first
 * control sits at border+12px on both axes, so the popover is 12px-padded and
 * 126px tall.
 *
 * The popover text is the platform UI font (`system-ui`): the design reference
 * renderer loads `@fontsource-variable/inter` as `Inter`, but that never reaches
 * the canvas string, so the baseline rasterises the labels in the OS UI font.
 * The fixture pins the same family (see `src/v3-fixture.tsx`); an Inter build
 * shifts every glyph and re-breaks the comparison.
 */
import { expect, test } from "@playwright/test";
import { compareToCrop } from "../../../e2e/visual-compare";

const cropUrl = (name: string) => new URL(`../../../e2e/fixtures/v3/${name}`, import.meta.url).pathname;

for (const theme of ["light", "dark"] as const) {
  test(`filter builder matches the States popover crop (${theme})`, async ({ page }) => {
    await page.goto(`/v3.html?theme=${theme}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const popover = page.locator(".sb-filter-builder");
    await expect(popover).toBeVisible();
    const result = await compareToCrop(page, popover, cropUrl(`states-filter-builder-${theme}.png`), {
      diffPath: `test-results/v3/filter-builder-${theme}.diff.png`,
    });
    console.log(`[v3-filter] ${theme}: ${result.differing}/${result.total} px differ (${(result.ratio * 100).toFixed(3)}%)`);
  });
}
