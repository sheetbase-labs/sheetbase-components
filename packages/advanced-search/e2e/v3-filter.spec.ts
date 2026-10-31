/**
 * COMP-04.3: the inline rule builder (`/v3.html?scene=rules`). The old States
 * popover crop is gone with the layout it compared against; these check the
 * behaviour the reference layout asks for: the And / Or rail, the group header,
 * the None of these switch, keyboard reordering and the narrow wrap.
 */
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`rail pills and group header (${theme})`, async ({ page }) => {
    await page.goto(`/v3.html?scene=rules&theme=${theme}`, { waitUntil: "networkidle" });
    const builder = page.locator(".sb-filter-builder");
    await expect(builder).toHaveAttribute("data-variant", "inline");
    // The root pill is a label, not a button.
    await expect(builder.locator("span.sb-fb-pill")).toHaveText("And");
    const group = page.getByRole("group", { name: "Group" });
    await expect(group.getByText("Group", { exact: true })).toBeVisible();
    await expect(group).toContainText("Group · 3 conditions");

    const pill = group.locator("button.sb-fb-pill");
    await expect(pill).toHaveText("Or");
    await pill.click();
    await expect(pill).toHaveText("And");
    await pill.click();
    await expect(pill).toHaveText("Or");

    await group.getByRole("button", { name: "None of these" }).click();
    await expect(group).toContainText("None of these · 3 conditions");
    await expect(group.locator("span.sb-fb-pill")).toHaveText("Or");
    await expect(group.locator("button.sb-fb-pill")).toHaveCount(0);
  });
}

test("Alt+ArrowDown on the grip moves a row down and keeps focus", async ({ page }) => {
  await page.goto("/v3.html?scene=rules", { waitUntil: "networkidle" });
  const fields = () => page.locator(".sb-fb-list").first().locator(":scope > .sb-fb-item > .sb-fb-row .sb-fb-field .sb-filter-select-value");
  await expect(fields()).toHaveText(["Seniority", "Currency"]);
  const grip = page.locator(".sb-fb-row").first().getByRole("button", { name: "Move condition", exact: true });
  await grip.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(fields()).toHaveText(["Currency", "Seniority"]);
  await expect(page.locator(".sb-fb-row").nth(1).getByRole("button", { name: "Move condition", exact: true })).toBeFocused();
});

test("dragging a row by its grip into the group moves it", async ({ page }) => {
  await page.goto("/v3.html?scene=rules", { waitUntil: "networkidle" });
  const group = page.getByRole("group", { name: "Group" });
  await expect(group).toContainText("3 conditions");
  const grip = page.locator(".sb-fb-row").first().getByRole("button", { name: "Move condition", exact: true });
  await grip.dragTo(group.locator(".sb-fb-row").nth(1));
  await expect(group).toContainText("4 conditions");
});

test("rows wrap in a narrow host", async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 900 });
  await page.goto("/v3.html?scene=rules&width=420", { waitUntil: "networkidle" });
  const row = page.locator(".sb-fb-row").first();
  const field = await row.locator(".sb-fb-field").boundingBox();
  const operator = await row.locator("select[aria-label=Operator]").boundingBox();
  expect(field && operator && operator.y > field.y + field.height - 1).toBe(true);
});
