import { expect, test } from "@playwright/test";

test("home page shows three live tables plus the functions gallery", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sheetbase Table" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bare bones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Default" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fully featured" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Functions", exact: true })).toBeVisible();
  await expect(page.getByRole("grid")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Open full page" })).toHaveCount(4);
});

test("home sections link to the standalone demo pages", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const bare = page.locator('section[aria-label="Bare bones table"]');
  const fallback = page.locator('section[aria-label="Default table"]');
  const featured = page.locator('section[aria-label="Fully featured table"]');
  const functions = page.locator('section[aria-label="Supported functions"]');
  await expect(bare.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/bare");
  await expect(fallback.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/default");
  await expect(featured.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/million");
  await expect(functions.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/functions");
  await expect(bare.getByRole("gridcell").first()).toContainText("SMP-2084");
});

test("home demos follow the OS theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Themed tables own data-theme themselves; surfaces (default + paged demos) keep their own.
  for (const layout of await page.locator(".table-layout").all()) {
    await expect(layout).toHaveAttribute("data-theme", "dark");
  }
  for (const surface of await page.locator(".table-surface").all()) {
    await expect(surface).toHaveAttribute("data-theme", "dark");
  }
  await expect(page.locator(".functions-demo")).toHaveAttribute("data-theme", "dark");
});
