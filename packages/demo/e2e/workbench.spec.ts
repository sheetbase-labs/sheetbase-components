import { expect, test, type Locator, type Page } from "@playwright/test";

/** The stack that currently owns a pane, located by one of its rendered components. */
const stackWith = (page: Page, selector: string) =>
  page.locator(".sb-pane-stack").filter({ has: page.locator(selector) });

/** Top-level workbench stacks, excluding those nested inside a component's own PaneLayout. */
const topStacks = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector(".sb-workbench-panes");
    if (!root) return 0;
    return [...root.querySelectorAll(".sb-pane-stack")].filter((stack) => stack.closest(".sb-panes") === root).length;
  });

/** Drag the table by empty space in its toolbar (past the formatting controls). */
async function dragTableOnto(page: Page, to: Locator) {
  const bar = await page.locator(".table-formatting-toolbar").boundingBox();
  const b = await to.boundingBox();
  if (!bar || !b) throw new Error("drag source or target not visible");
  await page.mouse.move(bar.x + bar.width * 0.82, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function reset(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => topStacks(page)).toBe(3);
}


/** Drag a named tab onto another pane. */
async function dragTabOnto(page: Page, tabName: string, to: Locator) {
  const tb = await page.getByRole("tab", { name: tabName }).boundingBox();
  const b = await to.boundingBox();
  if (!tb || !b) throw new Error("drag source or target not visible");
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("dragging a pane onto another splits it, never tabs it", async ({ page }) => {
  await reset(page);
  const explorer = stackWith(page, ".sheetbase-explorer");
  await dragTableOnto(page, explorer);

  // Both are lone panes side by side in one split — no tab group.
  await expect(explorer.getByRole("tab")).toHaveCount(0);
  await expect(stackWith(page, ".table-surface")).toHaveCount(1);
  const siblings = await page.evaluate(() => {
    const table = document.querySelector(".table-surface")?.closest(".sb-split-cell");
    const explorer = document.querySelector(".sheetbase-explorer")?.closest(".sb-split-cell");
    return Boolean(table && explorer && table.parentElement === explorer.parentElement);
  });
  expect(siblings).toBe(true);
});

test("preserves pane component state across a move", async ({ page }) => {
  await reset(page);
  await page.locator(".table-surface").evaluate((el) => el.setAttribute("data-marker", "kept"));

  await dragTableOnto(page, stackWith(page, ".sheetbase-explorer"));

  // Portals keep the same DOM node, so the marker survives the remount-free move.
  await expect(page.locator(".table-surface")).toHaveAttribute("data-marker", "kept");
});

test("persists the layout to localStorage and restores it", async ({ page }) => {
  await reset(page);
  await dragTabOnto(page, "Search", stackWith(page, ".table-surface"));
  await expect.poll(() => topStacks(page)).toBe(4);

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("sheetbase-demo:workbench")))
    .toContain('"version":1');

  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => topStacks(page)).toBe(4);
});

test("navigates and reorders tabs with the keyboard", async ({ page }) => {
  await reset(page);
  const table = stackWith(page, ".table-surface");
  await table.hover();
  await table.getByRole("button", { name: "Pane actions" }).click();
  await page.getByRole("menuitem", { name: "Explorer" }).click();

  const explorer = stackWith(page, ".sheetbase-explorer");
  await expect(explorer.getByRole("tab")).toHaveText(["Explorer", "Table"]);
  await explorer.getByRole("tab", { name: "Explorer" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(explorer.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(explorer.getByRole("tab")).toHaveText(["Table", "Explorer"]);
});

test("schema body is three resizable panes and drives the table header", async ({ page }) => {
  await reset(page);
  const schema = stackWith(page, ".sb-schema");
  await expect(page.locator(".sb-schema .sb-pane-stack")).toHaveCount(3);
  await expect(page.locator(".sb-schema .sb-resizer")).toHaveCount(2);

  // Selecting a model pipes its fields into the table pane.
  await schema.getByRole("button", { name: /Donor/ }).click();
  await expect(page.locator(".table-surface").getByText("name", { exact: true })).toBeVisible();
});

test("one app surface wraps the workbench", async ({ page }) => {
  await reset(page);
  await expect(page.locator(".sb-demo-workbench > .sb-frame")).toHaveCount(1);
  await expect(page.locator(".sb-workbench-panes")).toHaveClass(/sb-panes--shared/);
});

test("frameless panes own a single bar with re-homed actions", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });

  // Schema renders without its topbar; its actions live in the pane head.
  await expect(page.locator(".sb-schema .sb-topbar")).toHaveCount(0);
  await expect(analysis.getByRole("button", { name: "+ Model" })).toBeVisible();

  // Rules and search also host their internal bodies as panes.
  await expect(page.locator(".sb-rules .sb-pane-stack")).toHaveCount(2);
  await expect(page.locator(".sb-search .sb-pane-stack")).toHaveCount(2);
});

test("rules dry-run evaluates the table rows", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  await analysis.getByRole("tab", { name: "Rules" }).click();

  const rules = page.locator(".sb-rules");
  await expect(rules).toContainText("3 rows");
  await expect(rules).toContainText("of 3 rows");
  await expect(rules).toContainText("review-queue");
});

test("search filters the rows the rules evaluate", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });

  await analysis.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("button", { name: "+ Condition" }).first().click();
  const condition = page.locator(".sb-filter-rule").first();
  await condition.getByLabel("Field").selectOption("status");
  await condition.getByLabel("Operator").selectOption("eq");
  await condition.getByLabel("Value").fill("failed");

  await analysis.getByRole("tab", { name: "Rules" }).click();
  await expect(page.locator(".sb-rules")).toContainText("1 rows");
});

test("keeps a single theme control in the workbench", async ({ page }) => {
  await reset(page);
  // Components hide their built-in toggle when the host controls the theme.
  await expect(page.locator(".sb-theme-btn")).toHaveCount(1);
  await expect(page.locator(".table-formatting-toolbar .theme-toggle")).toHaveCount(0);
});

test("tabs a pane through its actions menu", async ({ page }) => {
  await reset(page);
  const table = stackWith(page, ".table-surface");
  await table.hover();
  await table.getByRole("button", { name: "Pane actions" }).click();
  await expect(page.getByText("Tab with")).toBeVisible();
  await page.getByRole("menuitem", { name: "Explorer" }).click();
  await expect(stackWith(page, ".sheetbase-explorer").getByRole("tab")).toHaveText(["Explorer", "Table"]);
});

test("re-opens a closed pane through the 'New pane…' action", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  await analysis.getByRole("tab", { name: "Search" }).click();
  await analysis.getByRole("button", { name: "Close pane" }).click();
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(0);

  await analysis.getByRole("button", { name: "Pane actions" }).click();
  await page.getByRole("menuitem", { name: "New pane…" }).click();
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(1);
});

test("splits a tab out into its own pane", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  await analysis.getByRole("tab", { name: "Search" }).click();
  await analysis.getByRole("button", { name: "Pane actions" }).click();
  await page.getByRole("menuitem", { name: "Split into pane" }).click();

  await expect.poll(() => topStacks(page)).toBe(4);
  await expect(analysis.getByRole("tab")).toHaveText(["Schema", "Rules"]);
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(1);
});

test("pops a tab out by dropping it back on its own pane", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  const searchTab = analysis.getByRole("tab", { name: "Search" });
  const tb = await searchTab.boundingBox();
  const ab = await analysis.boundingBox();
  if (!tb || !ab) throw new Error("tab or pane not visible");

  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => topStacks(page)).toBe(4);
  await expect(analysis.getByRole("tab")).toHaveText(["Schema", "Rules"]);
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(1);
});

test("dragging a tab onto a pane makes a new pane, not a tab group", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  const tableStack = stackWith(page, ".table-surface");
  const searchTab = analysis.getByRole("tab", { name: "Search" });
  const tb = await searchTab.boundingBox();
  const table = await tableStack.boundingBox();
  if (!tb || !table) throw new Error("tab or pane not visible");

  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(table.x + table.width / 2, table.y + table.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => topStacks(page)).toBe(4);
  await expect(tableStack.getByRole("tab")).toHaveCount(0);
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(1);
});

test("dropping a pane on a tab group adds a tab", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  await dragTableOnto(page, page.getByRole("tab", { name: "Schema" }));

  await expect(analysis.getByRole("tab", { name: "Table" })).toBeVisible();
  await expect(analysis.getByRole("tab")).toHaveText(["Schema", "Rules", "Search", "Table"]);
});

test("dragging a tab within its own tab strip reorders it", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });
  await dragTabOnto(page, "Search", page.getByRole("tab", { name: "Schema" }));

  await expect(analysis.getByRole("tab")).toHaveText(["Search", "Schema", "Rules"]);
  await expect.poll(() => topStacks(page)).toBe(3);
});

test("closes a pane, persists the close, and reset restores it", async ({ page }) => {
  await reset(page);
  const analysis = page.locator(".sb-pane-stack").filter({ has: page.getByRole("tab", { name: "Schema" }) });

  await analysis.getByRole("tab", { name: "Search" }).click();
  await analysis.getByRole("button", { name: "Close pane" }).click();
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("sheetbase-demo:workbench:closed")))
    .toContain("search");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.locator('[data-pane-id="search"]')).toHaveCount(1);
});
