const { chromium } = require("@playwright/test");
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
(async () => {
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto("http://localhost:4205/", { waitUntil: "networkidle" });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1600);
  const dump = () => p.evaluate(() => [...document.querySelectorAll(".sb-pane-stack")].filter((s) => s.closest(".sb-panes")?.classList.contains("sb-workbench-panes")).map((s) => ({ id: s.dataset.stackId, tabs: [...s.querySelectorAll('[role="tab"]')].map((t) => t.textContent) })));
  const table = p.locator(".sb-pane-stack").filter({ has: p.locator(".table-surface") });
  const tb = await table.boundingBox();
  console.log("table box:", JSON.stringify(tb));
  console.log("before:", JSON.stringify(await dump()));

  for (const frac of [0.5, 0.8]) {
    // fresh state each try
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    const tab = await p.getByRole("tab", { name: "Search" }).boundingBox();
    const tbox = await table.boundingBox();
    console.log(`\n-- drop at table height ${frac} --`);
    console.log("tab box:", JSON.stringify(tab));
    await p.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await p.mouse.down();
    await p.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height * frac, { steps: 16 });
    await p.waitForTimeout(200);
    const zone = await p.evaluate(() => { const z = document.querySelector(".sb-drop-zone"); return z ? z.className : "none"; });
    console.log("overlay:", zone);
    await p.mouse.up();
    await p.waitForTimeout(400);
    console.log("after:", JSON.stringify(await dump()));
  }
  await b.close();
})();
