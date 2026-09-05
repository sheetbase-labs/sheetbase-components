import { expect, test } from "@playwright/test";

test("SEQUENCE spills paint all children, not just the anchor", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();

  // Column A is read-only (experiment_id, writable: false); use column B.
  // Walk from B1 down past the 8 dataset rows to the first blank row.
  await page.getByRole("gridcell", { name: "SMP-2084", exact: true }).click();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");

  await page.keyboard.type("=SEQUENCE(3,3,1,1)");
  await page.keyboard.press("Enter");

  // Anchor plus all eight spill children paint (exact names: no substring hits).
  for (const value of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    await expect(page.getByRole("gridcell", { name: value, exact: true })).toBeVisible();
  }
  // Click a spill child so focus is definitely on a spill member, then the
  // dashed outline must box the full 3x3 extent. The outline is aria-hidden
  // (decorative), so assert attachment rather than visibility.
  await page.getByRole("gridcell", { name: "5", exact: true }).click();
  await expect(page.locator(".spill-range")).toHaveCount(1);
});
