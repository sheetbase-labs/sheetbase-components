import { expect, test } from "@playwright/test";

test("keeps the rendered DOM bounded while scrolling", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const viewport = page.locator(".spreadsheet");
  await viewport.evaluate((element) => { element.scrollTop = 7000; element.dispatchEvent(new Event("scroll")); });
  await expect(page.getByRole("rowheader", { name: "220", exact: true })).toBeVisible();
  expect(await page.getByRole("gridcell").count()).toBeLessThan(1_000);
  const viewportBox = await viewport.boundingBox();
  const headerBox = await page.locator(".column-header").first().boundingBox();
  expect(Math.abs((headerBox?.y ?? 0) - (viewportBox?.y ?? 0))).toBeLessThanOrEqual(2);
});
