import { expect, test, type Page } from "@playwright/test";

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

test("sort control orders bound rows locally without moving values between records", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const statusColumn = () => page.locator('[role="gridcell"][aria-colindex="7"]');
  const sort = page.getByRole("button", { name: "Sort status" });
  const source = await statusColumn().allTextContents();
  expect(source.length).toBeGreaterThan(1);
  // The demo grid is bound (datasetHeader.recordIdForRow) and uses the default
  // local sort mode: the query's sort drives a display view, so the rows
  // reorder while no value moves between records.
  await sort.click();
  await expect(sort).toHaveText(/▲/, { timeout: 15_000 });
  const ascending = await statusColumn().allTextContents();
  expect(ascending).not.toEqual(source);
  expect([...ascending].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))).toEqual(ascending);
  await sort.click();
  await expect(sort).toHaveText(/▼/, { timeout: 15_000 });
  const descending = await statusColumn().allTextContents();
  expect([...descending].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base" }))).toEqual(descending);
  await sort.click();
  await expect(sort).toHaveText(/↕/, { timeout: 15_000 });
  // Clearing the sort restores the source order, so every value kept its record.
  await expect(statusColumn()).toHaveText(source);
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

/** 0-based row/column → the gridcell locator (aria indexes are 1-based). */
const cellAt = (page: Page, row: number, column: number) =>
  page.locator(`[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${column + 1}"]`);

test("Ctrl+Arrow jumps to data edges and Shift extends", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const announcer = page.locator(".grid-announcer");
  await cellAt(page, 0, 0).click();
  // The demo block is populated A1:G8.
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(announcer).toContainText("A8");
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await expect(announcer).toContainText("G8");
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(announcer).toContainText("G1");
  await page.keyboard.press("Shift+ControlOrMeta+ArrowDown");
  await expect(announcer).toContainText("8 cells selected");
});

test("Ctrl+A selects the used range, then the whole sheet", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const announcer = page.locator(".grid-announcer");
  await cellAt(page, 9, 0).click(); // A10, outside the used range
  await page.keyboard.press("ControlOrMeta+a");
  await expect(announcer).toContainText("56 cells selected");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(announcer).toContainText("170,000 cells selected");
});

test("Shift+Space and Ctrl+Space select the row and column", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const announcer = page.locator(".grid-announcer");
  const cell = cellAt(page, 1, 1); // B2
  await cell.click();
  await page.keyboard.press("Shift+Space");
  await expect(announcer).toContainText("17 cells selected");
  await cell.click();
  await page.keyboard.press("ControlOrMeta+Space");
  await expect(announcer).toContainText("10,000 cells selected");
});

test("Enter edits the active cell, moves down past read-only cells and pastes once when a marquee is live", async ({ page, browserName }) => {
  // Playwright cannot synthesise clipboard shortcuts in Firefox.
  test.skip(browserName === "firefox", "Firefox does not dispatch copy for synthesised shortcuts");
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const announcer = page.locator(".grid-announcer");
  const editor = page.locator(".cell-editor");
  // Column A is a read-only dataset field, so Enter falls back to moving down.
  await cellAt(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await expect(announcer).toContainText("A2");
  await page.keyboard.press("Shift+Enter");
  await expect(announcer).toContainText("A1");
  // On an editable cell Enter opens the editor and Escape discards.
  await cellAt(page, 0, 1).click(); // B1
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  // Copy B1, move to B9, Enter pastes once and dismisses the marquee.
  await cellAt(page, 0, 1).click();
  await page.keyboard.press("ControlOrMeta+c");
  await expect(page.locator(".copy-outline")).toBeVisible();
  await cellAt(page, 8, 1).click(); // B9
  await page.keyboard.press("Enter");
  await expect(page.locator(".copy-outline")).toHaveCount(0);
  await expect(cellAt(page, 8, 1)).toContainText("SMP-2084");
});

test("double-clicking the fill handle fills to the adjacent data extent", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  await cellAt(page, 0, 6).click(); // G1 "Complete"
  await page.locator(".fill-handle").dblclick();
  // G3 was "Review"; the fill mirrors G1 down to row 8 alongside column F.
  await expect(cellAt(page, 2, 6)).toContainText("Complete");
});

test("drags a selection border to move the cell", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  const source = cellAt(page, 0, 1); // B1 "SMP-2084"
  const target = cellAt(page, 9, 1); // B10
  await source.click();
  const box = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!box || !targetBox) throw new Error("expected cell geometry");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await expect(page.locator(".move-outline")).toBeVisible();
  await page.mouse.up();
  await expect(source).toHaveText("");
  await expect(target).toContainText("SMP-2084");
});

test("overflows text into empty neighbouring cells", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  // Column G is the last populated column; H is empty, so G cells spill right.
  const cell = cellAt(page, 0, 6); // G1
  await expect(cell).toHaveClass(/spills/);
  await expect(cell).toHaveCSS("overflow", "visible");
});

test("shows selection aggregates in the sheet bar", async ({ page }) => {
  await page.goto("/default", { waitUntil: "domcontentloaded" });
  // D1:D3 = 18.42, 0.034, 29.18 (the result column).
  await cellAt(page, 0, 3).click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  const stats = page.locator(".sheet-bar-stats");
  await expect(stats).toContainText("Average: 15.88");
  await expect(stats).toContainText("Count: 3");
  await expect(stats).toContainText("Sum: 47.63");
});

test("Ctrl+; inserts today's date", async ({ page }) => {
  await page.goto("/functions", { waitUntil: "domcontentloaded" });
  await cellAt(page, 0, 2).click(); // C1, an empty cell on the unbound sheet
  await page.keyboard.press("ControlOrMeta+;");
  await expect(cellAt(page, 0, 2)).toContainText(/\d{4}-\d{2}-\d{2}/);
});
