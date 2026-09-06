import { expect, test } from "@playwright/test";

test("functions workbook calculates live in the grid", async ({ page }) => {
  await page.goto("/functions", { waitUntil: "domcontentloaded" });
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();

  // Dynamic arrays tab: names in column A, live results in column B.
  await expect(page.getByRole("gridcell", { name: "SEQUENCE", exact: true })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "1", exact: true }).first()).toBeVisible();

  // Lookup tab: XLOOKUP evaluates against the tab's own fixtures.
  await page.getByRole("tab", { name: "Lookup" }).click();
  // The value behind the cell is a real editable formula, not text: step
  // right from the XLOOKUP name cell (avoids the 1.72 fixture cell above).
  await page.getByRole("gridcell", { name: "XLOOKUP", exact: true }).first().click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("textbox", { name: "Formula" })).toHaveValue('=XLOOKUP("BCA",A1:A3,C1:C3)');
});
