import { expect, test } from "@playwright/test";

test("read-only grid blocks edits but keeps selection and sorting", async ({ page }) => {
  await page.goto("/readonly", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("grid")).toHaveAttribute("aria-readonly", "true");

  const cells = page.getByRole("gridcell");
  await cells.first().click();
  await expect(page.locator(".grid-announcer")).toContainText("A1");

  await page.keyboard.type("x");
  await expect(page.locator(".cell-editor")).toHaveCount(0);
  await cells.first().dblclick();
  await expect(page.locator(".cell-editor")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cell-editor")).toHaveCount(0);
  await expect(cells.first()).toContainText("EXP-1048");

  await expect(page.getByRole("button", { name: "Fill selection" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Formula" })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Add sheet" })).toHaveCount(0);

  const sort = page.getByRole("button", { name: "Sort status" });
  await sort.click();
  await expect(sort).toHaveText(/▲/, { timeout: 15_000 });

  await page.getByRole("rowheader", { name: "1", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Row menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Insert before" })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /Delete/ })).toHaveCount(0);
});
