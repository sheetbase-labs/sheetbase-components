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

/** Drag from a pane's own toolbar chrome onto another stack (centre = tab together). */
async function dragOnto(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("drag source or target not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
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

const tableGrab = (page: Page) => page.locator(".table-formatting-toolbar .format-spacer").first();

test("docks a pane by dragging its own toolbar", async ({ page }) => {
  await reset(page);
  const explorer = stackWith(page, ".sheetbase-explorer");
  await expect(explorer.getByRole("tab")).toHaveCount(0);

  await dragOnto(page, tableGrab(page), explorer);
  await expect(explorer.getByRole("tab")).toHaveText(["Explorer", "Table"]);
  // Source stack collapsed away, so the tree shrank.
  await expect.poll(() => topStacks(page)).toBe(2);
});

test("preserves pane component state across a move", async ({ page }) => {
  await reset(page);
  await page.locator(".table-surface").evaluate((el) => el.setAttribute("data-marker", "kept"));

  const explorer = stackWith(page, ".sheetbase-explorer");
  await dragOnto(page, tableGrab(page), explorer);

  await expect(explorer.getByRole("tab", { name: "Table" })).toBeVisible();
  // Portals keep the same DOM node, so the marker survives the remount-free move.
  await expect(page.locator(".table-surface")).toHaveAttribute("data-marker", "kept");
});

test("persists the layout to localStorage and restores it", async ({ page }) => {
  await reset(page);
  const explorer = stackWith(page, ".sheetbase-explorer");
  await dragOnto(page, tableGrab(page), explorer);
  await expect(explorer.getByRole("tab")).toHaveText(["Explorer", "Table"]);

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("sheetbase-demo:workbench")))
    .toContain('"version":1');

  await page.reload({ waitUntil: "networkidle" });
  await expect(stackWith(page, ".sheetbase-explorer").getByRole("tab")).toHaveText(["Explorer", "Table"]);
});

test("navigates and reorders tabs with the keyboard", async ({ page }) => {
  await reset(page);
  const explorer = stackWith(page, ".sheetbase-explorer");
  await dragOnto(page, tableGrab(page), explorer);

  await explorer.getByRole("tab", { name: "Explorer" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(explorer.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(explorer.getByRole("tab")).toHaveText(["Table", "Explorer"]);
});

test("schema body is three resizable panes and drives the table header", async ({ page }) => {
  await reset(page);
  const schema = stackWith(page, ".sb-schema");
  await expect(schema.locator(".sb-pane-stack")).toHaveCount(3);
  await expect(schema.locator(".sb-resizer")).toHaveCount(2);

  // Selecting a model pipes its fields into the table pane.
  await schema.getByRole("button", { name: /Order/ }).click();
  await expect(page.locator(".table-surface").getByText("customer_id", { exact: true })).toBeVisible();
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
