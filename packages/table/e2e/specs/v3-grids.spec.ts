/**
 * COMP-02.6 visual fixtures (exit): every design grid rendered from its own
 * fixture module under `src/ui/v3/`, compared with a crop of the matching
 * `sheetbase-eln/tests/visual/design-reference/<Screen>-{light,dark}.png`.
 *
 * A screen is discovered from its fixture module: `src/ui/v3/<name>.tsx` is
 * loaded as `/v3.html?fixture=<name>` and compared with
 * `e2e/fixtures/v3/<name>-{light,dark}.png`. Each module documents its own
 * crop box and the design screen it transcribes.
 *
 * The design renders are Chromium screenshots at deviceScaleFactor 1; the
 * comparison is meaningful only against the same engine, so this spec runs on
 * Chromium.
 */
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareToCrop } from "../../../../e2e/visual-compare";

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = resolve(here, "../../src/ui/v3");
const fixturesDir = resolve(here, "../../../../e2e/fixtures/v3");

/**
 * Screens whose fixture cannot yet match its crop record their measured cause
 * in `e2e/fixtures/v3/<name>.fail.txt`; the test then runs as an expected
 * failure instead of loosening the tolerance. The file must name a missing
 * component or engine behaviour, never a tuning gap.
 */
const failureCause = (name: string): string | undefined => {
  const file = resolve(fixturesDir, `${name}.fail.txt`);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
};

const names = readdirSync(modulesDir)
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => file.replace(/\.tsx$/, ""))
  .sort();

test.skip(({ browserName }) => browserName !== "chromium", "design renders are Chromium screenshots");

for (const name of names) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} (${theme})`, async ({ page }) => {
      const cause = failureCause(name);
      if (cause) test.fail(true, cause);
      await page.goto(`/v3.html?fixture=${name}&theme=${theme}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const grid = page.locator("#grid-fixture .spreadsheet");
      await expect(grid).toBeVisible();
      const result = await compareToCrop(page, grid, resolve(fixturesDir, `${name}-${theme}.png`), {
        diffPath: `test-results/v3/${name}-${theme}.diff.png`,
      });
      console.log(`[v3-grids] ${name} ${theme}: ${result.differing}/${result.total} px differ (${(result.ratio * 100).toFixed(3)}%)`);
    });
  }
}
