import { expect, test } from "@playwright/test";

test("renders a visible paged grid and hydrates its first page", async ({ page }) => {
  let releaseFirstPage: (() => void) | undefined;
  await page.route("**/api/table/pages?**", async (route) => {
    const url = new URL(route.request().url());
    const rowStart = Number(url.searchParams.get("rowStart") ?? 0);
    const rowCount = Number(url.searchParams.get("rowCount") ?? 200);
    const fieldIds = (url.searchParams.get("fieldIds") ?? "").split(",").filter(Boolean);
    if (rowStart === 0) await new Promise<void>((resolve) => { releaseFirstPage = resolve; });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        request: { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "" },
        totalRows: 1_000_000,
        revision: "r1",
        records: Array.from({ length: rowCount }, (_, offset) => ({
          recordId: `record-${rowStart + offset + 1}`,
          values: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, fieldId === "experiment_id" ? `EXP-${rowStart + offset + 1}` : ""])),
        })),
      }),
    });
  });

  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  expect((await grid.boundingBox())?.height).toBeGreaterThan(600);
  await expect(page.locator(".loading-placeholder").first()).toBeVisible();
  releaseFirstPage?.();
  releaseFirstPage = undefined;
  await expect(page.getByRole("gridcell").first()).toContainText("EXP-1");
  await expect(page.locator(".paged-status")).toContainText("1,000,000 rows loaded");
  await expect(page.locator(".paged-status")).toContainText(/API \d+ ms · hydrate \d+ ms · render \d+ ms/);
  await page.getByRole("gridcell").first().click();
  await expect(page.locator(".paged-status")).toContainText(/click \d+\.\d ms/);
});

test("keeps table tools inside the compact surface", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const surface = page.locator(".table-surface");
  await expect(surface).toHaveClass(/with-companion/);
  await expect(page.getByLabel("Conditional formatting", { exact: true })).toBeVisible();

  const rules = page.locator(".conditional-rules button");
  const originalRuleOrder = await rules.allTextContents();
  await rules.first().click();
  await expect(rules).toHaveText(originalRuleOrder);
  await page.getByLabel("Comparison value").selectOption("Review");
  await expect(page.getByLabel("Comparison value")).toHaveValue("Review");
  const ruleCount = await rules.count();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(rules).toHaveCount(ruleCount - 1);

  await page.getByRole("button", { name: "Color scale" }).click();
  await expect(page.getByText("Scale", { exact: true })).toBeVisible();
  await page.getByLabel("Condition field").selectOption("result");
  await expect(page.getByLabel("Condition field")).toHaveValue("result");

  await page.getByLabel("Close conditional formatting").click();
  await expect(surface).not.toHaveClass(/with-companion/);
  await expect(page.getByLabel("Open conditional formatting")).toBeVisible();

  await page.getByLabel("Open conditional formatting").click();
  await expect(surface).toHaveClass(/with-companion/);
  await page.getByLabel("Close conditional formatting").click();

  await page.getByRole("columnheader").filter({ hasText: "status" }).click({ button: "right" });
  await page.getByRole("menu").getByText("Conditional formatting…").click();
  await expect(surface).toHaveClass(/with-companion/);
  await expect(page.getByLabel("Conditional formatting", { exact: true })).toBeVisible();
});

test("builds filters and manages columns without named views", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Filter field").selectOption("status");
  await page.getByLabel("Filter operator").selectOption("eq");
  await page.getByLabel("Filter value").selectOption("Review");
  await page.getByRole("button", { name: "Add filter" }).click();
  await expect(page.locator(".filter-chip")).toContainText("status");
  await expect(page.getByText("Save view", { exact: true })).toHaveCount(0);
  await page.getByText("Columns", { exact: true }).click();
  await page.getByLabel("Search columns").fill("approved");
  await page.locator(".column-picker").getByText("approved").click();
  await expect(page.getByRole("columnheader").filter({ hasText: "approved" })).toHaveCount(0);
});

test("targets an entire row and persists presentation state", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Format target").selectOption("row");
  await expect(page.getByLabel("Format target")).toHaveValue("row");
  await page.getByLabel("Format target").selectOption("column");
  await page.getByLabel("Target column").selectOption("result");
  await expect(page.getByLabel("Target column")).toHaveValue("result");
  await page.getByLabel("Close conditional formatting").click();

  const cells = page.getByRole("gridcell");
  await cells.nth(0).click();
  await page.getByRole("toolbar", { name: "Format selection" }).getByRole("button", { name: "Bold" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Open conditional formatting")).toBeVisible();
  await expect(page.getByRole("gridcell").nth(0)).toHaveCSS("font-weight", "600");
});

test("directly formats cells, ranges, rows and columns from the toolbar", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const toolbar = page.getByRole("toolbar", { name: "Format selection" });
  await expect(toolbar).toBeVisible();

  const cells = page.getByRole("gridcell");
  await toolbar.getByRole("button", { name: "Text colour" }).click();
  await expect(page.locator(".format-swatches")).toBeVisible();
  await page.getByRole("button", { name: "Text colour #7652ef" }).click();
  await expect(page.locator(".format-swatches")).toHaveCount(0);
  await cells.nth(0).dragTo(cells.nth(10));
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(cells.nth(0)).toHaveCSS("font-weight", "600");
  await expect(cells.nth(10)).toHaveCSS("font-weight", "600");
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveClass(/active/);

  await page.getByRole("columnheader").filter({ hasText: "status" }).click();
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(page.locator('.grid-cell[style*="font-weight: 600"]').first()).toBeVisible();

  await page.getByRole("rowheader").nth(2).click();
  await toolbar.getByRole("button", { name: "Align centre" }).click();
  await expect(toolbar.locator(".format-selection")).toContainText(":");
});

test("resizes and restores a surface object", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const object = page.locator('[data-object-id="conditional-formatting"]');
  const before = await object.boundingBox();
  const surfaceBox = await page.locator(".table-surface").boundingBox();
  const tableBox = await page.locator(".table-surface-table").boundingBox();
  const resizer = object.locator(".surface-resizer.horizontal");
  const box = await resizer.boundingBox();
  if (!before || !box || !surfaceBox || !tableBox) throw new Error("Surface object was not measurable");
  expect(Math.abs(tableBox.y - (surfaceBox.y + 4))).toBeLessThanOrEqual(2);
  expect(Math.abs(before.y - (surfaceBox.y + 4))).toBeLessThanOrEqual(2);
  expect(tableBox.height).toBeGreaterThan(surfaceBox.height - 12);
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + 40);
  await page.mouse.up();
  const after = await object.boundingBox();
  expect(after?.width).toBeGreaterThan(before.width + 40);
  await page.reload({ waitUntil: "commit" });
  const restored = page.locator('[data-object-id="conditional-formatting"]');
  await expect(restored).toBeVisible();
  expect((await restored.boundingBox())?.width).toBeGreaterThan(before.width + 40);
});

test("cycles light, dark and system themes and follows the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const surface = page.locator(".table-surface");
  // Fresh installs default to system, which resolves to light here.
  await expect(surface).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Use light mode").click();
  await expect(surface).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Use dark mode").click();
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(surface).toHaveCSS("background-color", "rgb(28, 27, 32)");
  await expect(page.locator(".grid-cell").first()).toHaveCSS("background-color", "rgb(25, 24, 28)");
  await page.getByLabel("Use system mode").click();
  await expect(surface).toHaveAttribute("data-theme", "light");
  // Presentation persists on idle: wait for the system mode to land in
  // storage before reloading, or the reload races the write and reads back
  // the previous dark mode.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("sheetbase-table:presentation:experiments") ?? ""), { timeout: 10_000 })
    .toContain('"theme":"system"');
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(surface).toHaveAttribute("data-theme", "light");
  // The persisted system mode tracks the OS without another click.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(surface).toHaveAttribute("data-theme", "dark");
});

test("builds typed filter conditions", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  await page.getByText("Filters", { exact: true }).click();

  await page.getByLabel("Filter field").selectOption("result");
  await page.getByLabel("Filter operator").selectOption("between");
  await page.getByLabel("Minimum value").fill("1");
  await page.getByLabel("Maximum value").fill("9");
  await page.getByRole("button", { name: "Add filter" }).click();
  await expect(page.locator(".filter-chip").first()).toContainText("result");
  await expect(page.locator(".filter-chip").first()).toContainText("Between 1 – 9");

  await page.getByLabel("Filter field").selectOption("run_date");
  await page.getByLabel("Filter operator").selectOption("withinLastDays");
  await page.getByLabel("Number of days").fill("90");
  await page.getByRole("button", { name: "Add filter" }).click();
  await expect(page.locator(".filter-chip").nth(1)).toContainText("run_date");
  await expect(page.locator(".filter-chip").nth(1)).toContainText("Within the last 90 days");

  await page.getByLabel("Filter field").selectOption("status");
  await page.getByLabel("Filter operator").selectOption("in");
  await page.locator(".filter-options").getByText("Complete").click();
  await page.locator(".filter-options").getByText("Flagged").click();
  await page.getByRole("button", { name: "Add filter" }).click();
  await expect(page.locator(".filter-chip").nth(2)).toContainText("status");
  await expect(page.locator(".filter-chip").nth(2)).toContainText("Is any of Complete, Flagged");
  await expect(page.locator(".filter-chip")).toHaveCount(3);
});

test("reorders columns with drag and drop and keeps accessible move buttons", async ({ page }) => {
  await page.route("**/api/table/pages?**", async (route) => {
    const url = new URL(route.request().url());
    const rowStart = Number(url.searchParams.get("rowStart") ?? 0);
    const rowCount = Number(url.searchParams.get("rowCount") ?? 200);
    const fieldIds = (url.searchParams.get("fieldIds") ?? "").split(",").filter(Boolean);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        request: { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "" },
        totalRows: 1_000_000,
        revision: "r1",
        records: [],
      }),
    });
  });
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("columnheader").first()).toBeVisible();
  const firstName = () => page.locator(".column-header").first().locator(".column-name").textContent();
  expect(await firstName()).toBe("experiment_id");

  await page.getByText("Columns", { exact: true }).click();
  await page.dragAndDrop('.column-manager-row:has-text("sample_id")', '.column-manager-row:has-text("experiment_id")');
  await expect.poll(firstName).toBe("sample_id");

  await page.getByLabel("Search columns").fill("sample_id");
  await page.getByLabel("Move sample_id down").click();
  await expect.poll(firstName).toBe("experiment_id");
});

test("closes portal popovers with Escape and restores focus", async ({ page }) => {
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  const filtersTrigger = page.getByText("Filters", { exact: true });
  await filtersTrigger.click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
  await expect(filtersTrigger).toBeFocused();

  await page.getByText("Columns", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Columns" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Columns" })).toHaveCount(0);
  await expect(page.getByText("Columns", { exact: true })).toBeFocused();
});

test("keeps cell selection commits bounded in the paged grid", async ({ page }) => {
  await page.route("**/api/table/pages?**", async (route) => {
    const url = new URL(route.request().url());
    const rowStart = Number(url.searchParams.get("rowStart") ?? 0);
    const rowCount = Number(url.searchParams.get("rowCount") ?? 200);
    const fieldIds = (url.searchParams.get("fieldIds") ?? "").split(",").filter(Boolean);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        request: { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "" },
        totalRows: 1_000_000,
        revision: "r1",
        records: Array.from({ length: rowCount }, (_, offset) => ({
          recordId: `record-${rowStart + offset + 1}`,
          values: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, fieldId === "experiment_id" ? `EXP-${rowStart + offset + 1}` : ""])),
        })),
      }),
    });
  });
  await page.goto("/million", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("gridcell").first()).toContainText("EXP-1");
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (globalThis as { __pagedGridRenders?: number }).__pagedGridRenders ?? 0);
  await page.getByRole("gridcell").first().click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => (globalThis as { __pagedGridRenders?: number }).__pagedGridRenders ?? 0);
  // Chromium commits ~3, Firefox ~5 (virtualizer measure passes); a parent-cascade
  // regression would push this well past the budget on every browser.
  expect(after - before).toBeLessThanOrEqual(5);
});
