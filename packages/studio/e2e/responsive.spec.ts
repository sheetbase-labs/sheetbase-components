import { expect, test, type Page } from "@playwright/test";

/**
 * Studio at phone, tablet, laptop and wall sizes — wide, short and tall.
 * Every size must: never scroll the page sideways, keep every top-bar and
 * toolbar control inside its bar, and draw the chart at its stage's real
 * height (no scaled text, no letterboxing).
 */
const SIZES: readonly [number, number][] = [
  [320, 568], [390, 844], [844, 390], [768, 1024], [1024, 600],
  [1280, 500], [1366, 768], [1440, 400], [1920, 1080], [2560, 1440],
];

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".chart-stage svg").first()).toBeVisible({ timeout: 30_000 });
  // Let the chart settle on its measured height.
  await page.waitForTimeout(500);
}

/** Layout problems at the current size, as readable strings. */
function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways by ${document.documentElement.scrollWidth - vw}px`);
    const inside = (bar: Element | null, items: Iterable<Element>, label: string) => {
      if (!bar) return;
      const b = bar.getBoundingClientRect();
      if (!b.width) return;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1) problems.push(`${label}: "${(item.textContent ?? "").trim().slice(0, 24)}" leaves its bar`);
      }
    };
    const topbar = document.querySelector(".sbs-studio > .sb-frame > .sb-topbar");
    inside(topbar, document.querySelectorAll(".sbs-studio > .sb-frame > .sb-topbar > *, .sbs-studio > .sb-frame > .sb-topbar > .sb-topbar-actions > *"), "top bar");
    const actions = topbar?.querySelector(":scope > .sb-topbar-actions")?.getBoundingClientRect();
    const bar = topbar?.getBoundingClientRect();
    if (actions && bar && bar.right - actions.right > 16) problems.push("top-bar actions are not at the right edge");
    const command = document.querySelector(".explorer-commandbar-v4");
    const subbar = document.querySelector(".explorer-subbar");
    inside(command, command?.querySelectorAll(":scope > .tool-anchor, :scope > button") ?? [], "chart toolbar");
    inside(subbar, subbar?.querySelectorAll(":scope > *") ?? [], "chart sub-toolbar");
    const c = command?.getBoundingClientRect();
    const s = subbar?.getBoundingClientRect();
    if (c?.width && s?.width && c.bottom > s.top + 1) problems.push("chart toolbars overlap");
    const search = document.querySelector(".sb-search .sb-topbar");
    inside(search, search?.querySelectorAll(".sb-topbar-actions > *") ?? [], "filter bar");
    return problems;
  });
}

/** Chart drawing height vs. the stage content box it is stretched to fill. */
function chartFit(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".chart-stage") as HTMLElement | null;
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return null;
    const style = getComputedStyle(stage);
    const content = stage.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    const drawn = svg.viewBox.baseVal?.height || Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
    return { content, drawn, shown: svg.getBoundingClientRect().height };
  });
}

for (const [width, height] of SIZES) {
  test(`lays out cleanly at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    expect(await layoutProblems(page)).toEqual([]);
    const fit = await chartFit(page);
    expect(fit).not.toBeNull();
    // Drawn at the size it is shown: text is never scaled.
    expect(Math.abs((fit?.drawn ?? 0) - (fit?.shown ?? 0))).toBeLessThanOrEqual(2);
    // A short screen still leaves a usable chart.
    expect(fit?.shown ?? 0).toBeGreaterThanOrEqual(150);
  });
}

test("short screens tab the chart with the rows instead of squeezing both", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await ready(page);
  await expect(page.getByRole("tab", { name: "Rows" })).toBeVisible();
  await expect(page.locator(".sbs-fields")).toBeVisible();
});

test("a filter survives resizing across every layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const fieldButton = page.locator(".sbs-field-row").filter({ has: page.locator(".sbs-spark") }).nth(0);
  await fieldButton.click();
  const bin = page.locator(".sbs-bin:not([disabled]), .sbs-value:not([disabled])").first();
  await bin.click();
  const conditions = page.locator(".sb-search .sb-topbar .sb-stat").last();
  await expect(conditions).toContainText("1 condition");
  for (const [width, height] of [[390, 844], [1280, 500], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    expect(await layoutProblems(page), `${width}×${height}`).toEqual([]);
  }
  await expect(conditions).toContainText("1 condition");
});

test("adapts to its container, not the window (notebook cell)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  await page.addStyleTag({ content: ".sbs-demo { width: 600px; height: 520px; }" });
  await page.waitForTimeout(500);
  expect(await layoutProblems(page)).toEqual([]);
  // 600px wide is below the narrow threshold: one tabbed stack.
  await expect(page.getByRole("tab", { name: "Fields" })).toBeVisible();
});

test.describe("phone headers", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the top bar is one row with the rest behind More actions", async ({ page }) => {
    await ready(page);
    const bar = page.locator(".sbs-studio > .sb-frame > .sb-topbar");
    expect((await bar.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40);
    await expect(bar.getByRole("button", { name: "Export chart" })).toBeHidden();

    const more = page.getByRole("button", { name: "More actions" });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Open file…", "Export chart", "Provenance", "Dark mode"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    // Escape closes and hands focus back to the trigger.
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();

    // Choosing an item runs it and closes the menu.
    await more.click();
    await page.getByRole("button", { name: "Dark mode" }).click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".sbs-studio")).toHaveAttribute("data-theme", "dark");
  });

  test("headers above the chart stay compact", async ({ page }) => {
    await ready(page);
    const stage = await page.locator(".chart-stage").boundingBox();
    // Top bar + pane tabs + two chart toolbars.
    expect(stage?.y ?? 999).toBeLessThanOrEqual(170);
    // One stack of tabs needs no pane menu beside Studio's own.
    await expect(page.getByRole("button", { name: "Pane actions" })).toHaveCount(0);
  });

  test("the chart's Import menu is Studio's job, not the explorer's", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".explorer-subbar").getByRole("button", { name: /^Import/ })).toHaveCount(0);
  });
});
