import { expect, test } from "@playwright/test";

test("renders one compact semantic header row", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const headers = page.locator(".column-header");
  await expect(headers.nth(0)).toContainText("Aexperiment_id");
  await expect(page.locator(".dataset-field-header")).toHaveCount(0);
  await expect(page.getByRole("rowheader", { name: "1", exact: true })).toBeVisible();
});

test("inserts a semantic column reference without leaving edit mode", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await page.getByRole("gridcell").nth(8).click();
  await page.keyboard.type("=");
  await page.locator(".column-header").filter({ hasText: "status" }).click();
  await expect(page.locator(".cell-editor")).toHaveValue("=[status]");
  await expect(page.locator(".formula-reference")).toBeVisible();
});

test("switches sheets while keeping a single spreadsheet renderer", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Samples/ }).click();
  await expect(page.locator(".spreadsheet")).toHaveCount(1);
  await expect(page.getByRole("gridcell").first()).toContainText("SMP-2084");
  await page.getByRole("tab", { name: /Experiments/ }).click();
  await expect(page.getByRole("gridcell").first()).toContainText("EXP-1048");
});

test("sort control cycles the query sort without moving bound rows locally", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const statusCell = () => page.getByRole("gridcell").nth(6);
  await expect(statusCell()).toContainText(/Complete|Review|Flagged/);
  const baseline = await statusCell().textContent();
  if (baseline === null) throw new Error("expected status cell text");
  const sort = page.getByRole("button", { name: "Sort status" });
  // The demo grid is bound (datasetHeader.recordIdForRow): row order is
  // server-owned, so the control cycles query.sort via onQueryChange and the
  // local rows stay put.
  await sort.click();
  await expect(sort).toHaveText(/▲/, { timeout: 15_000 });
  await expect(statusCell()).toContainText(baseline);
  await sort.click();
  await expect(sort).toHaveText(/▼/, { timeout: 15_000 });
  await expect(statusCell()).toContainText(baseline);
  await sort.click();
  await expect(sort).toHaveText(/↕/, { timeout: 15_000 });
  await expect(statusCell()).toContainText(baseline);
});

test("opens keyboard shortcut help from the grid", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await page.getByRole("gridcell").first().click();
  await page.keyboard.type("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("selects semantic ranges while editing from the formula bar", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await page.getByRole("gridcell").nth(8).click();
  await page.getByRole("textbox", { name: "Formula" }).fill("=");
  await page.locator(".column-header").filter({ hasText: "result" }).click();
  await expect(page.getByRole("textbox", { name: "Formula" })).toHaveValue("=[result]");
  await expect(page.locator(".formula-reference")).toBeVisible();
  await expect(page.locator(".formula-tokens .reference-green")).toContainText("[result]");
});

test("uses dedicated controlled and relationship editors", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const cells = page.getByRole("gridcell");
  await cells.nth(6).dblclick();
  await page.getByRole("option", { name: "Flagged" }).click();
  await expect(cells.nth(6)).toContainText("Flagged");

  await cells.nth(7).dblclick();
  await page.locator(".cell-editor").fill("david");
  await page.getByRole("option", { name: "David Okafor" }).click();
  await expect(cells.nth(7)).toContainText("David Okafor");
});

test("renders plain status text and context-menu actions", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("gridcell").nth(6)).toHaveText(/Complete|Review|Flagged/);
  await expect(page.locator(".demo-status-badge")).toHaveCount(0);

  await page.getByRole("columnheader").filter({ hasText: "status" }).click({ button: "right" });
  await page.getByRole("menu").getByRole("button", { name: "Copy column name" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("marks the copied range with a dashed marquee until Escape", async ({ page, browserName }) => {
  // Playwright cannot synthesise clipboard shortcuts in Firefox; the real
  // copy event path is covered by the chromium and webkit projects.
  test.skip(browserName === "firefox", "Firefox does not dispatch copy for synthesised shortcuts");
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await page.getByRole("gridcell").first().click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ControlOrMeta+c");
  const marquee = page.locator(".copy-outline");
  await expect(marquee).toBeVisible();
  // Excel semantics: the marquee stays on the source range while the
  // selection moves elsewhere so repeat pastes keep their target context.
  await page.keyboard.press("ArrowDown");
  await expect(marquee).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(marquee).toHaveCount(0);
});

test("announces selection through a polite live region", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const announcer = page.locator(".grid-announcer");
  await page.getByRole("gridcell").first().click();
  await expect(announcer).toContainText("A1");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(announcer).toContainText("cells selected");
});
